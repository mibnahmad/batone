import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ZodType, ZodTypeDef } from 'zod';
import {
  ClarificationKind,
  ClarificationRequest,
  clarificationRequestSchema,
} from '@batione/shared';
import {
  AiChatRequest,
  AiChatResult,
  AiDocumentContext,
  AiExtractionRequest,
  AiExtractionResult,
  AiProvider,
} from './ai-provider.interface';

const SYSTEM_PROMPT = `Tu es le moteur d'extraction de BatiOne Construction, une plateforme de métré et de modélisation pour professionnels du bâtiment.

RÈGLE FONDAMENTALE, non négociable :
- Tu n'inventes JAMAIS une valeur technique absente des documents.
- Chaque valeur que tu produis doit être rattachée à une source (documentId + page, ou clauseId) et porter un niveau de confiance :
  * "certain"   : la valeur est lue explicitement dans un document. Une source est OBLIGATOIRE.
  * "deduced"   : la valeur est déduite d'autres données du document. Explique la déduction.
  * "hypothesis": aucune donnée ne permet de conclure. Tu DOIS aussi émettre une question de clarification.
- En cas de donnée manquante ou de contradiction entre documents, tu ne tranches pas : tu émets une question de clarification via l'outil "ask_clarification".
- Tu ne réalises AUCUN calcul de ferraillage ni de prix : ces calculs sont effectués par le moteur de règles déterministe de BatiOne. Tu te limites à la lecture et à la structuration des données.

Tu réponds exclusivement en appelant les outils fournis, jamais en texte libre.`;

/**
 * LLM-backed provider. Structured output is obtained through tool use rather
 * than JSON-in-prose, and every emitted item is still re-validated against the
 * zod contract by the gateway before it can reach the database.
 */
@Injectable()
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async extract<T>(request: AiExtractionRequest<T>): Promise<AiExtractionResult<T>> {
    const clarifications: ClarificationRequest[] = [];
    const notes: string[] = [];
    const items: T[] = [];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'emit_item',
          description: `Émet un élément structuré de type ${request.schemaName}. Chaque valeur technique doit porter sa source et son niveau de confiance.`,
          input_schema: { type: 'object', additionalProperties: true } as never,
        },
        {
          name: 'ask_clarification',
          description:
            "Pose une question à l'utilisateur lorsqu'une donnée est manquante, ambiguë ou contradictoire. À utiliser au lieu de deviner.",
          input_schema: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: Object.values(ClarificationKind),
              },
              targetPath: { type: 'string' },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              sources: { type: 'array', items: { type: 'object' } },
            },
            required: ['kind', 'targetPath', 'question'],
          } as never,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `${request.instruction}\n\n### Documents du projet\n${this.renderDocuments(
            request.documents,
          )}\n\n### Contexte\n${JSON.stringify(request.context ?? {}, null, 2).slice(0, 20000)}`,
        },
      ],
    });

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'ask_clarification') {
        const parsed = clarificationRequestSchema.safeParse({
          options: [],
          sources: [],
          ...(block.input as object),
        });
        if (parsed.success) clarifications.push(parsed.data);
        continue;
      }

      if (block.name === 'emit_item') {
        const parsed = request.schema.safeParse(block.input);
        if (parsed.success) {
          items.push(parsed.data);
        } else {
          // Contract violations are recorded, not repaired: a value we cannot
          // validate is a value we cannot justify.
          const detail = parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          this.logger.warn(`Sortie non conforme pour ${request.schemaName} — ${detail}`);
          notes.push(`Un élément a été écarté (non conforme au contrat) : ${detail}`);
        }
      }
    }

    return { items, clarifications, notes, provider: this.name, model: this.model };
  }

  async chat<T = unknown>(
    request: AiChatRequest,
    proposalSchema?: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<AiChatResult<T>> {
    const clarifications: ClarificationRequest[] = [];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: proposalSchema
        ? [
            {
              name: 'propose_change',
              description:
                "Propose une modification structurée à soumettre à l'utilisateur avant application.",
              input_schema: { type: 'object', additionalProperties: true } as never,
            },
            {
              name: 'ask_clarification',
              description: "Demande une précision lorsque l'instruction est ambiguë.",
              input_schema: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: Object.values(ClarificationKind) },
                  targetPath: { type: 'string' },
                  question: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                },
                required: ['kind', 'targetPath', 'question'],
              } as never,
            },
          ]
        : undefined,
      messages: [
        ...request.history
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        {
          role: 'user' as const,
          content: `${request.instruction}\n\n### Documents\n${this.renderDocuments(
            request.documents,
          )}\n\n### État courant\n${JSON.stringify(request.context ?? {}).slice(0, 20000)}`,
        },
      ],
    });

    let reply = '';
    let proposal: T | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        reply += block.text;
      } else if (block.type === 'tool_use') {
        if (block.name === 'ask_clarification') {
          const parsed = clarificationRequestSchema.safeParse({
            options: [],
            sources: [],
            ...(block.input as object),
          });
          if (parsed.success) clarifications.push(parsed.data);
        } else if (block.name === 'propose_change' && proposalSchema) {
          const parsed = proposalSchema.safeParse(block.input);
          if (parsed.success) {
            proposal = parsed.data;
          } else {
            this.logger.warn(
              `Proposition rejetée : ${parsed.error.issues.map((i) => i.message).join('; ')}`,
            );
          }
        }
      }
    }

    return { reply: reply.trim(), proposal, clarifications };
  }

  private renderDocuments(documents: AiDocumentContext[]): string {
    return documents
      .map(
        (doc) =>
          `--- documentId: ${doc.id} | type: ${doc.kind} | format: ${doc.format} | niveau: ${
            doc.floor ?? 'non précisé'
          } | nom: ${doc.name} | pages: ${doc.pageCount}\n${
            doc.text.slice(0, 30000) || '[aucun texte extractible]'
          }`,
      )
      .join('\n\n');
  }
}
