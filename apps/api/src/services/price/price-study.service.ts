import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  ConfidenceLevel,
  PipelineStep,
  PriceItemInput,
  ServiceId,
  SourceRef,
} from '@batione/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { TraceabilityService } from '../../common/traceability.service';
import { RulesService } from '../../rules/rules.service';
import { PriceCalculator, type PriceCalcItem } from '../../rules/price-calculator';
import { JobsService, type JobContext, type ServiceEngine } from '../../jobs/jobs.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuthUser } from '../../auth/auth.decorators';
import type { ParsedDocument } from '../../documents/document-processing.service';

/**
 * Service 4 — Étude de prix.
 *
 * Quantities and unit prices come from the user (or are imported from the
 * takeoff); the price chain itself is computed by the deterministic
 * PriceCalculator using a versioned, BatiOne-owned formula. The engine has no
 * dependency on any external price feed, so a future price-database add-on is
 * additive rather than structural.
 */
@Injectable()
export class PriceStudyService implements ServiceEngine, OnModuleInit {
  readonly service = ServiceId.PRICE_STUDY;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
    private readonly calculator: PriceCalculator,
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
    private readonly trace: TraceabilityService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerEngine(this);
  }

  async run(ctx: JobContext): Promise<unknown> {
    await ctx.report(PipelineStep.IMPORT, 8, 'Lecture des quantités importées…');

    const study = await this.ensureStudy(ctx.projectId);

    await ctx.report(PipelineStep.ANALYSIS_2D, 25, 'Analyse des quantités…');

    // A re-run re-reads the bordereau, so machine-imported rows are rebuilt.
    // Rows the user entered or corrected are user-confirmed and are kept.
    await this.prisma.priceItem.deleteMany({
      where: { studyId: study.id, confidence: { not: ConfidenceLevel.USER_CONFIRMED } },
    });

    const imported = await this.importFromDocuments(ctx.projectId, study.id, ctx.userId);

    await ctx.report(PipelineStep.SPECIFICATIONS, 45, 'Chargement des formules BatiOne…');
    await ctx.report(PipelineStep.DETECTION, 62, 'Rapprochement des postes…');

    if (imported === 0) {
      const fromTakeoff = await this.importFromTakeoff(ctx.projectId, study.id, ctx.userId);
      await ctx.report(
        PipelineStep.DETECTION,
        70,
        `${fromTakeoff} poste(s) repris du métré automatisé.`,
      );
    }

    await ctx.report(PipelineStep.GENERATION, 82, 'Calcul déterministe du prix…');
    const result = await this.recompute(ctx.projectId, ctx.organizationId);

    await ctx.report(PipelineStep.VERIFICATION, 94, 'Vérification de la décomposition…');

    return {
      items: result.items.length,
      finalPrice: result.breakdown?.finalPrice ?? 0,
      currency: result.study.currency,
    };
  }

  /** Reads quantity rows out of an uploaded XLSX/CSV bordereau. */
  private async importFromDocuments(
    projectId: string,
    studyId: string,
    userId: string,
  ): Promise<number> {
    const documents = await this.prisma.projectDocument.findMany({
      where: { projectId, kind: 'quantities' },
    });

    let imported = 0;
    for (const document of documents) {
      const parsed = document.parsed as ParsedDocument | null;
      if (!parsed?.rows?.length) continue;

      for (const row of parsed.rows) {
        const item = this.rowToItem(row);
        if (!item) continue;

        const duplicate = await this.prisma.priceItem.findFirst({
          where: { studyId, designation: item.designation, unit: item.unit },
        });
        if (duplicate) continue;

        await this.prisma.priceItem.create({
          data: {
            studyId,
            code: item.code,
            designation: item.designation,
            category: item.category,
            unit: item.unit,
            quantity: item.quantity,
            unitPriceMaterials: item.unitPriceMaterials,
            unitPriceLabour: item.unitPriceLabour,
            unitPriceEquipment: item.unitPriceEquipment,
            confidence: ConfidenceLevel.CERTAIN,
            sourceRefs: [
              { documentId: document.id, page: 1, excerpt: item.designation },
            ] as never,
            orderIndex: imported,
          },
        });
        imported += 1;
      }
    }
    void userId;
    return imported;
  }

  /** Column-name matching is tolerant because bordereaux are never standardised. */
  private rowToItem(row: Record<string, unknown>): PriceItemInput | null {
    // Header keys arrive from JSONB, whose key order is *not* the CSV column
    // order, so matching must be driven by the priority of the wanted names and
    // never by iteration order — otherwise "PU materiel" can answer a request
    // for "PU materiaux".
    const entries = Object.entries(row).map(([key, value]) => [
      key
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
      value,
    ] as const);

    const get = (...names: string[]): unknown => {
      for (const name of names) {
        const exact = entries.find(([key]) => key === name);
        if (exact) return exact[1];
      }
      for (const name of names) {
        const loose = entries.find(([key]) => key.includes(name));
        if (loose) return loose[1];
      }
      return undefined;
    };

    const designation = String(get('designation', 'libelle', 'ouvrage', 'description') ?? '').trim();
    if (!designation) return null;

    const num = (value: unknown): number => {
      if (typeof value === 'number') return value;
      const parsed = Number.parseFloat(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      code: String(get('code', 'ref') ?? ''),
      designation,
      category: String(get('categorie', 'lot') ?? 'divers'),
      unit: String(get('unite', 'unit') ?? 'u'),
      quantity: num(get('quantite', 'qte', 'quantity')),
      unitPriceMaterials: num(
        get('pu materiaux', 'materiaux', 'materiau', 'fourniture', 'pu fourniture'),
      ),
      unitPriceLabour: num(
        get('pu main d oeuvre', 'main d oeuvre', 'main doeuvre', 'pu mo', 'mo', 'labour'),
      ),
      unitPriceEquipment: num(
        get('pu materiel', 'materiel', 'equipement', 'engin', 'pu engin'),
      ),
      sources: [],
      confidence: ConfidenceLevel.CERTAIN,
    };
  }

  /**
   * Bridges service 1 into service 4. Quantities keep the provenance and the
   * confidence tier they had in the takeoff — an assumed quantity must stay
   * visibly assumed once it carries a price.
   */
  async importFromTakeoff(
    projectId: string,
    studyId: string,
    userId: string,
  ): Promise<number> {
    const lines = await this.prisma.takeoffLine.findMany({ where: { projectId } });
    let index = await this.prisma.priceItem.count({ where: { studyId } });
    let imported = 0;

    for (const line of lines) {
      const existing = await this.prisma.priceItem.findFirst({
        where: { studyId, designation: line.ouvrage, unit: line.unit },
      });
      if (existing) continue;

      const sources = this.trace.readSourceRefs(line.sourceRefs);
      await this.prisma.priceItem.create({
        data: {
          studyId,
          code: '',
          designation: line.ouvrage,
          category: line.category,
          unit: line.unit,
          quantity: line.quantity ?? 0,
          confidence: line.confidence,
          sourceRefs: this.trace.mergeSources(sources, [
            {
              ruleId: 'takeoff-import',
              ruleVersion: '1',
              note: `Quantité reprise du métré (${line.floor})`,
            } satisfies SourceRef,
          ]) as never,
          orderIndex: index++,
        },
      });
      imported += 1;
    }

    void userId;
    return imported;
  }

  /* ---------------------------------------------------------------- */

  async ensureStudy(projectId: string) {
    const existing = await this.prisma.priceStudy.findFirst({ where: { projectId } });
    if (existing) return existing;
    return this.prisma.priceStudy.create({ data: { projectId } });
  }

  async read(projectId: string, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);
    const study = await this.ensureStudy(projectId);
    const items = await this.prisma.priceItem.findMany({
      where: { studyId: study.id },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
    const rules = await this.rules.priceRules(organizationId, study.ruleSetId);

    return {
      study,
      items,
      breakdown: study.breakdown,
      categorySubtotals: this.subtotals(items),
      assumptions: items
        .filter((item) => item.confidence === ConfidenceLevel.HYPOTHESIS)
        .map((item) => ({
          id: item.id,
          designation: item.designation,
          quantity: item.quantity,
          unit: item.unit,
        })),
      ruleSet: { id: rules.id, key: rules.key, version: rules.version, label: rules.label },
    };
  }

  /** Single source of truth for every displayed amount. */
  async recompute(projectId: string, organizationId: string) {
    const study = await this.ensureStudy(projectId);
    const items = await this.prisma.priceItem.findMany({
      where: { studyId: study.id },
      orderBy: [{ orderIndex: 'asc' }],
    });
    const rules = await this.rules.priceRules(organizationId, study.ruleSetId);

    const calcItems: PriceCalcItem[] = items.map((item) => ({
      id: item.id,
      category: item.category,
      quantity: item.quantity,
      unitPriceMaterials: item.unitPriceMaterials,
      unitPriceLabour: item.unitPriceLabour,
      unitPriceEquipment: item.unitPriceEquipment,
    }));

    const output = this.calculator.compute(
      calcItems,
      rules.definition,
      rules.id,
      rules.version,
    );

    for (const result of output.items) {
      await this.prisma.priceItem.update({
        where: { id: result.id },
        data: {
          totalMaterials: result.totalMaterials,
          totalLabour: result.totalLabour,
          totalEquipment: result.totalEquipment,
          total: result.total,
        },
      });
    }

    const updated = await this.prisma.priceStudy.update({
      where: { id: study.id },
      data: { breakdown: output.breakdown as never, currency: rules.definition.currency },
    });

    const refreshed = await this.prisma.priceItem.findMany({
      where: { studyId: study.id },
      orderBy: [{ orderIndex: 'asc' }],
    });

    return {
      study: updated,
      items: refreshed,
      breakdown: output.breakdown,
      categorySubtotals: output.categorySubtotals,
      ruleSet: { id: rules.id, key: rules.key, version: rules.version, label: rules.label },
    };
  }

  async addItem(projectId: string, user: AuthUser, input: PriceItemInput) {
    await this.projects.assertOwned(projectId, user.organizationId);
    const study = await this.ensureStudy(projectId);
    const count = await this.prisma.priceItem.count({ where: { studyId: study.id } });

    await this.prisma.priceItem.create({
      data: {
        studyId: study.id,
        code: input.code,
        designation: input.designation,
        category: input.category,
        unit: input.unit,
        quantity: input.quantity,
        unitPriceMaterials: input.unitPriceMaterials,
        unitPriceLabour: input.unitPriceLabour,
        unitPriceEquipment: input.unitPriceEquipment,
        confidence: ConfidenceLevel.USER_CONFIRMED,
        sourceRefs: [
          {
            ruleId: 'user-input',
            ruleVersion: '1',
            note: `Poste saisi par ${user.fullName}`,
          },
        ] as never,
        orderIndex: count,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId,
      actorId: user.id,
      service: this.service,
      action: 'price.item.create',
      payload: { designation: input.designation },
    });

    return this.recompute(projectId, user.organizationId);
  }

  async updateItem(
    itemId: string,
    user: AuthUser,
    dto: { field: string; value: unknown; reason?: string },
  ) {
    const item = await this.prisma.priceItem.findFirst({
      where: { id: itemId, study: { project: { organizationId: user.organizationId } } },
      include: { study: true },
    });
    if (!item) throw new NotFoundException('Poste introuvable.');

    const numericFields = [
      'quantity',
      'unitPriceMaterials',
      'unitPriceLabour',
      'unitPriceEquipment',
    ];
    const textFields = ['code', 'designation', 'category', 'unit'];

    let newValue: unknown;
    if (numericFields.includes(dto.field)) {
      newValue = Number(dto.value);
      if (!Number.isFinite(newValue as number)) {
        throw new NotFoundException('Valeur numérique invalide.');
      }
    } else if (textFields.includes(dto.field)) {
      newValue = String(dto.value ?? '');
    } else {
      throw new NotFoundException(`Champ « ${dto.field} » non modifiable.`);
    }

    const previousValue = (item as unknown as Record<string, unknown>)[dto.field];

    await this.prisma.priceItem.update({
      where: { id: item.id },
      data: {
        [dto.field]: newValue,
        confidence: ConfidenceLevel.USER_CONFIRMED,
        correctionHistory: this.trace.appendCorrection(item.correctionHistory, {
          field: dto.field,
          previousValue,
          newValue,
          previousConfidence: item.confidence as ConfidenceLevel,
          actorId: user.id,
          reason: dto.reason,
        }) as never,
      } as never,
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId: item.study.projectId,
      actorId: user.id,
      service: this.service,
      action: 'price.item.update',
      entityType: 'PriceItem',
      entityId: item.id,
      payload: { field: dto.field, previousValue, newValue },
    });

    return this.recompute(item.study.projectId, user.organizationId);
  }

  async removeItem(itemId: string, user: AuthUser) {
    const item = await this.prisma.priceItem.findFirst({
      where: { id: itemId, study: { project: { organizationId: user.organizationId } } },
      include: { study: true },
    });
    if (!item) throw new NotFoundException('Poste introuvable.');

    await this.prisma.priceItem.delete({ where: { id: item.id } });
    return this.recompute(item.study.projectId, user.organizationId);
  }

  async updateStudy(
    projectId: string,
    user: AuthUser,
    patch: { ruleSetId?: string | null; name?: string; currency?: string },
  ) {
    await this.projects.assertOwned(projectId, user.organizationId);
    const study = await this.ensureStudy(projectId);

    await this.prisma.priceStudy.update({
      where: { id: study.id },
      data: {
        ...(patch.ruleSetId !== undefined ? { ruleSetId: patch.ruleSetId } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.currency ? { currency: patch.currency } : {}),
      },
    });

    return this.recompute(projectId, user.organizationId);
  }

  async importTakeoff(projectId: string, user: AuthUser) {
    await this.projects.assertOwned(projectId, user.organizationId);
    const study = await this.ensureStudy(projectId);
    const imported = await this.importFromTakeoff(projectId, study.id, user.id);
    const result = await this.recompute(projectId, user.organizationId);
    return { imported, ...result };
  }

  private subtotals(items: { category: string; total: number }[]) {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.category, round2((map.get(item.category) ?? 0) + item.total));
    }
    return [...map.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
