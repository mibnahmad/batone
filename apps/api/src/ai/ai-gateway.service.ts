import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodType, ZodTypeDef } from 'zod';
import {
  ClarificationKind,
  ClarificationRequest,
  ConfidenceLevel,
  ServiceId,
  SourceRef,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { DocumentsService } from '../documents/documents.service';
import type { ParsedDocument } from '../documents/document-processing.service';
import {
  AI_PROVIDER,
  AiChatRequest,
  AiChatResult,
  AiDocumentContext,
  AiExtractionRequest,
  AiExtractionResult,
  AiProvider,
} from './ai-provider.interface';
import { ClarificationService } from './clarification.service';

export interface GatewayExtractionOptions<T> {
  projectId: string;
  organizationId: string;
  service: ServiceId;
  task: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaName: string;
  instruction: string;
  documentKinds?: string[];
  context?: Record<string, unknown>;
}

/**
 * The single door through which every AI-produced value enters the system.
 *
 * Responsibilities that deliberately live here rather than in each service:
 *  - schema enforcement (already applied by providers, re-checked here),
 *  - source binding: strip provenance-free "certain" claims,
 *  - clarification persistence: questions become rows that block finalization,
 *  - auditing of which provider/model produced what.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly threshold: number;

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly clarifications: ClarificationService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.threshold = Number(config.get('CLARIFICATION_THRESHOLD') ?? 0.55);
  }

  get providerName(): string {
    return `${this.provider.name}/${this.provider.model}`;
  }

  /** Builds the grounding context: parsed documents in provider-neutral shape. */
  async buildDocumentContext(
    projectId: string,
    kinds?: string[],
    documentIds?: string[],
  ): Promise<AiDocumentContext[]> {
    const documents = await this.documents.contextFor(projectId);
    return documents
      .filter((doc) => (kinds ? kinds.includes(doc.kind) : true))
      .filter((doc) => (documentIds?.length ? documentIds.includes(doc.id) : true))
      .map((doc) => {
        const parsed = (doc.parsed as ParsedDocument | null) ?? null;
        return {
          id: doc.id,
          kind: doc.kind,
          format: doc.format,
          name: doc.label || doc.originalName,
          floor: doc.floor,
          text: parsed?.text ?? '',
          pageCount: parsed?.pageCount ?? 0,
          entities: parsed ?? undefined,
        } satisfies AiDocumentContext;
      });
  }

  async extract<T>(options: GatewayExtractionOptions<T>): Promise<{
    items: T[];
    clarificationIds: string[];
    notes: string[];
  }> {
    const documents = await this.buildDocumentContext(
      options.projectId,
      options.documentKinds,
    );

    const request: AiExtractionRequest<T> = {
      task: options.task,
      schema: options.schema,
      schemaName: options.schemaName,
      instruction: options.instruction,
      documents,
      context: options.context,
    };

    let result: AiExtractionResult<T>;
    try {
      result = await this.provider.extract(request);
    } catch (err) {
      this.logger.error(`Extraction ${options.task} échouée : ${String(err)}`);
      throw err;
    }

    const sanitized = result.items.map((item) =>
      this.enforceSourceBinding(item as unknown, options.task),
    ) as T[];

    const clarificationIds = await this.clarifications.persist(
      options.projectId,
      options.service,
      result.clarifications,
    );

    await this.audit.record({
      organizationId: options.organizationId,
      projectId: options.projectId,
      actorType: 'ai',
      service: options.service,
      action: `ai.extract.${options.task}`,
      payload: {
        provider: result.provider,
        model: result.model,
        items: sanitized.length,
        clarifications: clarificationIds.length,
        documents: documents.map((d) => d.id),
      },
    });

    return { items: sanitized, clarificationIds, notes: result.notes };
  }

  async chat<T = unknown>(
    options: {
      projectId: string;
      organizationId: string;
      service: ServiceId;
      task: string;
      instruction: string;
      history: { role: 'user' | 'assistant' | 'system'; content: string }[];
      context?: Record<string, unknown>;
      documentKinds?: string[];
    },
    proposalSchema?: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<AiChatResult<T> & { clarificationIds: string[] }> {
    const documents = await this.buildDocumentContext(
      options.projectId,
      options.documentKinds,
    );

    const request: AiChatRequest = {
      task: options.task,
      instruction: options.instruction,
      history: options.history,
      documents,
      context: options.context,
    };

    const result = await this.provider.chat<T>(request, proposalSchema);
    const clarificationIds = await this.clarifications.persist(
      options.projectId,
      options.service,
      result.clarifications,
    );

    await this.audit.record({
      organizationId: options.organizationId,
      projectId: options.projectId,
      actorType: 'ai',
      service: options.service,
      action: `ai.chat.${options.task}`,
      payload: { hasProposal: Boolean(result.proposal), clarificationIds },
    });

    return { ...result, clarificationIds };
  }

  /**
   * Walks an extracted object and downgrades any `certain` claim that is not
   * actually bound to a source. Providers are asked to respect this rule; the
   * gateway is where it is *guaranteed*.
   */
  private enforceSourceBinding(node: unknown, task: string): unknown {
    if (Array.isArray(node)) {
      return node.map((child) => this.enforceSourceBinding(child, task));
    }
    if (node === null || typeof node !== 'object') return node;

    const record = { ...(node as Record<string, unknown>) };

    for (const [key, value] of Object.entries(record)) {
      record[key] = this.enforceSourceBinding(value, task);
    }

    if (typeof record.confidence === 'string') {
      const sources = Array.isArray(record.sources) ? (record.sources as SourceRef[]) : [];
      if (record.confidence === ConfidenceLevel.CERTAIN && sources.length === 0) {
        this.logger.warn(
          `[${task}] valeur déclarée "certain" sans source : rétrogradée en "deduced".`,
        );
        record.confidence = ConfidenceLevel.DEDUCED;
      }
      if (
        typeof record.score === 'number' &&
        record.score < this.threshold &&
        record.confidence === ConfidenceLevel.CERTAIN
      ) {
        record.confidence = ConfidenceLevel.DEDUCED;
      }
    }

    return record;
  }

  /** Threshold under which a value must become a question rather than a result. */
  get clarificationThreshold(): number {
    return this.threshold;
  }

  buildLowConfidenceQuestion(
    targetPath: string,
    label: string,
    options: string[] = [],
    sources: SourceRef[] = [],
  ): ClarificationRequest {
    return {
      kind: ClarificationKind.LOW_CONFIDENCE,
      targetPath,
      question: `La valeur « ${label} » n'a pas pu être établie avec une confiance suffisante. Pouvez-vous la confirmer ?`,
      options,
      sources,
    };
  }
}
