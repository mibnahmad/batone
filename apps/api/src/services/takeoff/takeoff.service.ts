import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  cctpClauseExtractionSchema,
  ConfidenceLevel,
  CorrectionDto,
  DocumentKind,
  PipelineStep,
  ServiceId,
  SourceRef,
  takeoffLineExtractionSchema,
  type TakeoffLineExtraction,
} from '@batione/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { TraceabilityService } from '../../common/traceability.service';
import { AiGatewayService } from '../../ai/ai-gateway.service';
import { ClarificationService } from '../../ai/clarification.service';
import { RulesService } from '../../rules/rules.service';
import { JobsService, type JobContext, type ServiceEngine } from '../../jobs/jobs.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuthUser } from '../../auth/auth.decorators';
import { embed, cosineSimilarity } from './clause-index';

/**
 * Service 1 — Métré automatisé.
 *
 * Plans + CCTP in, a traceable takeoff table out. Every line is linked to the
 * clause of the specification that justifies it, and any line whose inputs are
 * still under clarification is marked `blocked` so it cannot be treated as final.
 */
@Injectable()
export class TakeoffService implements ServiceEngine, OnModuleInit {
  readonly service = ServiceId.TAKEOFF;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly clarifications: ClarificationService,
    private readonly rules: RulesService,
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
    private readonly trace: TraceabilityService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerEngine(this);
  }

  async run(ctx: JobContext): Promise<unknown> {
    await ctx.report(PipelineStep.IMPORT, 5, 'Lecture des documents importés…');

    const documents = await this.prisma.projectDocument.findMany({
      where: { projectId: ctx.projectId },
    });
    if (documents.length === 0) {
      throw new Error('Aucun document à analyser. Importez au moins un plan.');
    }

    await ctx.report(PipelineStep.ANALYSIS_2D, 20, 'Analyse des plans (géométrie et cotations)…');

    /* ---- Step: CCTP clauses -------------------------------------- */
    await ctx.report(PipelineStep.SPECIFICATIONS, 35, 'Lecture du cahier des charges…');
    const clauseCount = await this.ingestClauses(ctx);

    /* ---- Step: detection + generation ---------------------------- */
    await ctx.report(PipelineStep.DETECTION, 55, 'Détection des ouvrages…');

    const clauses = await this.prisma.cctpClause.findMany({
      where: { projectId: ctx.projectId },
      select: { id: true, category: true, reference: true, text: true, embedding: true },
    });

    const extraction = await this.gateway.extract<TakeoffLineExtraction>({
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      service: this.service,
      task: 'takeoff.lines',
      schema: takeoffLineExtractionSchema,
      schemaName: 'TakeoffLine',
      instruction:
        "Analyse les plans du projet et produis les lignes de métré. Pour chaque ligne, indique l'ouvrage, l'unité, le niveau, la quantité avec sa source et son niveau de confiance, ainsi que les dimensions utilisées. N'invente aucune dimension absente des documents : pose une question de clarification.",
      context: {
        clauses: clauses.map((c) => ({ id: c.id, category: c.category })),
      },
    });

    await ctx.report(PipelineStep.GENERATION, 75, 'Génération du tableau de métré…');

    const takeoffRules = await this.rules.takeoffRules(ctx.organizationId);
    const answers = await this.clarifications.resolvedValues(ctx.projectId, this.service);
    const blocked = await this.clarifications.blockedPaths(ctx.projectId, this.service);

    // A re-run replaces AI-produced lines but must not silently discard the
    // human corrections already recorded against them.
    const previous = await this.prisma.takeoffLine.findMany({
      where: { projectId: ctx.projectId },
    });
    const previousByKey = new Map(
      previous.map((line) => [`${line.floor}|${line.ouvrage}`, line]),
    );

    await this.prisma.takeoffLine.deleteMany({ where: { projectId: ctx.projectId } });

    let created = 0;
    for (const line of extraction.items) {
      const resolved = this.applyAnswers(line, answers);
      const sources = this.trace.normalizeSourceRefs(
        `takeoff.${resolved.ouvrage}`,
        resolved.quantity.sources,
      );
      const confidence = this.trace.coerceConfidence(resolved.quantity.confidence, sources);

      const clauseIds = this.linkClauses(resolved, clauses);
      const isBlocked = this.isBlocked(resolved, blocked);

      const machineQuantity = roundTo(
        resolved.quantity.value,
        takeoffRules.definition.quantityDecimals,
      );

      // A quantity a human confirmed outranks a fresh machine reading: the
      // re-run keeps the confirmed value and records the divergence instead of
      // silently reverting the correction.
      const earlier = previousByKey.get(`${resolved.floor}|${resolved.ouvrage}`);
      let history = this.trace.readHistory(earlier?.correctionHistory);
      let quantity = machineQuantity;
      let finalConfidence = confidence;

      if (
        earlier &&
        earlier.confidence === ConfidenceLevel.USER_CONFIRMED &&
        earlier.quantity !== null
      ) {
        quantity = earlier.quantity;
        finalConfidence = ConfidenceLevel.USER_CONFIRMED;
        if (machineQuantity !== earlier.quantity) {
          history = this.trace.appendCorrection(history, {
            field: 'quantity',
            previousValue: machineQuantity,
            newValue: earlier.quantity,
            previousConfidence: confidence,
            actorId: ctx.userId,
            reason: 'Ré-analyse : la valeur confirmée par l’utilisateur est conservée.',
          });
        }
      }

      await this.prisma.takeoffLine.create({
        data: {
          projectId: ctx.projectId,
          ouvrage: resolved.ouvrage,
          description: resolved.description,
          category: resolved.category,
          unit: resolved.unit,
          floor: resolved.floor,
          quantity,
          dimensions: resolved.dimensions as never,
          confidence: finalConfidence,
          score: resolved.quantity.score ?? null,
          sourceRefs: sources as never,
          clauseIds,
          blocked: isBlocked,
          correctionHistory: history as never,
        },
      });
      created += 1;
    }

    await ctx.report(PipelineStep.VERIFICATION, 92, 'Vérification et traçabilité…');

    return {
      lines: created,
      clauses: clauseCount,
      ruleSet: `${takeoffRules.key}@${takeoffRules.version}`,
    };
  }

  /** Extracts and indexes CCTP clauses so lines can be justified against them. */
  private async ingestClauses(ctx: JobContext): Promise<number> {
    const cctpDocs = await this.prisma.projectDocument.findMany({
      where: { projectId: ctx.projectId, kind: DocumentKind.CCTP },
      select: { id: true },
    });
    if (cctpDocs.length === 0) return 0;

    const extraction = await this.gateway.extract({
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      service: this.service,
      task: 'takeoff.clauses',
      schema: cctpClauseExtractionSchema,
      schemaName: 'CctpClause',
      instruction:
        'Découpe le cahier des charges en clauses numérotées. Pour chaque clause, restitue sa référence, son titre, son texte intégral et, si elle énonce une prescription chiffrée, la règle extraite.',
      documentKinds: [DocumentKind.CCTP],
    });

    await this.prisma.cctpClause.deleteMany({ where: { projectId: ctx.projectId } });

    const documentId = cctpDocs[0].id;
    for (const clause of extraction.items) {
      await this.prisma.cctpClause.create({
        data: {
          projectId: ctx.projectId,
          documentId,
          reference: clause.reference,
          title: clause.title,
          text: clause.text,
          extractedRule: clause.extractedRule ?? null,
          category: clause.category,
          page: clause.page ?? null,
          embedding: embed(`${clause.title} ${clause.text}`),
        },
      });
    }
    return extraction.items.length;
  }

  /**
   * Clause retrieval. Category matching gives the coarse link; a lexical
   * embedding refines the ordering. Kept in-process because the clause count per
   * project is small — a vector database would be premature here.
   */
  private linkClauses(
    line: TakeoffLineExtraction,
    clauses: { id: string; category: string; text: string; embedding: number[] }[],
  ): string[] {
    if (line.cctpClauseIds.length > 0) return line.cctpClauseIds;
    if (clauses.length === 0) return [];

    const query = embed(`${line.ouvrage} ${line.description} ${line.category}`);
    return clauses
      .map((clause) => ({
        id: clause.id,
        score:
          cosineSimilarity(query, clause.embedding) +
          (clause.category === line.category ? 0.25 : 0),
      }))
      .filter((entry) => entry.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.id);
  }

  /** Substitutes values the user supplied in answer to a clarification. */
  private applyAnswers(
    line: TakeoffLineExtraction,
    answers: Map<string, { numeric: number | null }>,
  ): TakeoffLineExtraction {
    const heightAnswer = answers.get(`takeoff.${line.floor}.wallHeight`)?.numeric;
    const thicknessAnswer = answers.get(`takeoff.${line.floor}.wallThickness`)?.numeric;
    if (heightAnswer === undefined && thicknessAnswer === undefined) return line;

    const dimensions = line.dimensions.map((dim) => {
      if (dim.name === 'hauteur' && heightAnswer != null) {
        return {
          ...dim,
          value: { ...dim.value, value: heightAnswer, confidence: ConfidenceLevel.USER_CONFIRMED },
        };
      }
      if (dim.name === 'épaisseur' && thicknessAnswer != null) {
        return {
          ...dim,
          value: { ...dim.value, value: thicknessAnswer, confidence: ConfidenceLevel.USER_CONFIRMED },
        };
      }
      return dim;
    });

    // Quantities are recomputed from the confirmed dimensions rather than scaled,
    // so the published number always matches the dimensions shown beside it.
    const linear = dimensions.find((d) => d.name === 'linéaire de murs')?.value.value;
    const height = dimensions.find((d) => d.name === 'hauteur')?.value.value;
    const thickness = dimensions.find((d) => d.name === 'épaisseur')?.value.value;

    let quantity = line.quantity.value;
    if (linear != null && height != null) {
      if (line.unit === 'm2') quantity = linear * height;
      if (line.unit === 'm3' && thickness != null) quantity = linear * height * thickness;
    }

    const stillWeak = dimensions.some(
      (d) => d.value.confidence === ConfidenceLevel.HYPOTHESIS,
    );

    return {
      ...line,
      dimensions,
      quantity: {
        ...line.quantity,
        value: quantity,
        confidence: stillWeak ? ConfidenceLevel.DEDUCED : ConfidenceLevel.USER_CONFIRMED,
      },
    };
  }

  private isBlocked(line: TakeoffLineExtraction, blocked: Set<string>): boolean {
    if (blocked.size === 0) return false;
    for (const path of blocked) {
      if (path.startsWith(`takeoff.${line.floor}.`)) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Read + correction API                                             */
  /* ---------------------------------------------------------------- */

  async read(projectId: string, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);

    const [lines, clauses] = await Promise.all([
      this.prisma.takeoffLine.findMany({
        where: { projectId },
        orderBy: [{ floor: 'asc' }, { category: 'asc' }, { ouvrage: 'asc' }],
      }),
      this.prisma.cctpClause.findMany({
        where: { projectId },
        select: {
          id: true,
          reference: true,
          title: true,
          text: true,
          category: true,
          page: true,
          extractedRule: true,
          documentId: true,
        },
      }),
    ]);

    const byUnit = new Map<string, number>();
    const byFloor = new Map<string, number>();
    for (const line of lines) {
      byUnit.set(line.unit, round2((byUnit.get(line.unit) ?? 0) + (line.quantity ?? 0)));
      byFloor.set(line.floor, (byFloor.get(line.floor) ?? 0) + 1);
    }

    return {
      lines,
      clauses,
      summary: {
        lineCount: lines.length,
        blockedCount: lines.filter((l) => l.blocked).length,
        hypothesisCount: lines.filter((l) => l.confidence === ConfidenceLevel.HYPOTHESIS).length,
        totalsByUnit: [...byUnit.entries()].map(([unit, total]) => ({ unit, total })),
        floors: [...byFloor.keys()].sort(),
        categories: [...new Set(lines.map((l) => l.category))].sort(),
      },
    };
  }

  /**
   * Applies a user correction. The previous value is appended to the line's
   * correction history and the confidence tier is promoted to `user_confirmed`.
   */
  async correct(lineId: string, user: AuthUser, dto: CorrectionDto) {
    const line = await this.prisma.takeoffLine.findFirst({
      where: { id: lineId, project: { organizationId: user.organizationId } },
    });
    if (!line) throw new NotFoundException('Ligne de métré introuvable.');

    const editable = ['quantity', 'ouvrage', 'description', 'unit', 'floor', 'category'];
    if (!editable.includes(dto.field)) {
      throw new NotFoundException(`Champ « ${dto.field} » non modifiable.`);
    }

    const previousValue = (line as unknown as Record<string, unknown>)[dto.field];
    const newValue =
      dto.field === 'quantity' ? Number(dto.value) : String(dto.value ?? '');

    if (dto.field === 'quantity' && !Number.isFinite(newValue as number)) {
      throw new NotFoundException('Quantité invalide.');
    }

    const history = this.trace.appendCorrection(line.correctionHistory, {
      field: dto.field,
      previousValue,
      newValue,
      previousConfidence: line.confidence as ConfidenceLevel,
      actorId: user.id,
      reason: dto.reason,
    });

    const userSource: SourceRef = {
      ruleId: 'user-correction',
      ruleVersion: '1',
      note: dto.reason ?? `Corrigé par ${user.fullName}`,
    };

    const updated = await this.prisma.takeoffLine.update({
      where: { id: line.id },
      data: {
        [dto.field]: newValue,
        confidence: ConfidenceLevel.USER_CONFIRMED,
        // The correction resolves the uncertainty that blocked this line.
        blocked: false,
        sourceRefs: this.trace.mergeSources(
          this.trace.readSourceRefs(line.sourceRefs),
          [userSource],
        ) as never,
        correctionHistory: history as never,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId: line.projectId,
      actorId: user.id,
      service: this.service,
      action: 'takeoff.correct',
      entityType: 'TakeoffLine',
      entityId: line.id,
      payload: { field: dto.field, previousValue, newValue, reason: dto.reason },
    });

    // The whole table is returned: a correction can change subtotals and unblock
    // sibling lines, so a single-row response would leave the UI inconsistent.
    void updated;
    return this.read(line.projectId, user.organizationId);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
