import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  ConfidenceLevel,
  DocumentKind,
  Element3D as Element3DContract,
  EditOperation,
  EditProposal,
  editProposalSchema,
  element3DSchema,
  PipelineStep,
  ServiceId,
} from '@batione/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { TraceabilityService } from '../../common/traceability.service';
import { AiGatewayService } from '../../ai/ai-gateway.service';
import { JobsService, type JobContext, type ServiceEngine } from '../../jobs/jobs.service';
import { ProjectsService } from '../../projects/projects.service';
import { AuthUser } from '../../auth/auth.decorators';

type PrismaElement = Awaited<
  ReturnType<PrismaService['element3D']['findFirstOrThrow']>
>;

interface BoxGeometry {
  kind: 'box';
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

/**
 * Service 2 — 2D → 3D.
 *
 * Generates a massing model from the level plans and exposes a chat-driven edit
 * engine. Edits are never applied straight from natural language: the assistant
 * returns a *proposal* with a diff, the user confirms, and only then is the
 * change applied and recorded with its exact inverse so undo is lossless.
 */
@Injectable()
export class Model3DService implements ServiceEngine, OnModuleInit {
  readonly service = ServiceId.MODEL_3D;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
    private readonly trace: TraceabilityService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerEngine(this);
  }

  async run(ctx: JobContext): Promise<unknown> {
    await ctx.report(PipelineStep.IMPORT, 5, 'Lecture des plans de niveau…');

    const plans = await this.prisma.projectDocument.findMany({
      where: { projectId: ctx.projectId, kind: DocumentKind.PLAN },
    });
    if (plans.length === 0) {
      throw new Error('Aucun plan de niveau importé.');
    }

    await ctx.report(PipelineStep.ANALYSIS_2D, 22, 'Vectorisation et lecture des plans…');
    await ctx.report(PipelineStep.SPECIFICATIONS, 38, 'Enrichissement depuis le cahier des charges…');
    await ctx.report(PipelineStep.DETECTION, 55, 'Détection des murs, dalles et ouvertures…');

    const extraction = await this.gateway.extract<Element3DContract>({
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      service: this.service,
      task: 'model3d.elements',
      schema: element3DSchema,
      schemaName: 'Element3D',
      instruction:
        "Génère les éléments 3D (murs, dalles, poteaux, ouvertures) à partir des plans de niveau. Les hauteurs et épaisseurs doivent provenir des plans ou du CCTP ; si elles sont absentes, pose une question de clarification au lieu de choisir une valeur.",
    });

    await ctx.report(PipelineStep.GENERATION, 78, 'Génération du modèle 3D…');

    const floors = [...new Set(extraction.items.map((e) => e.floor))];
    const previous = await this.prisma.model3D.findFirst({
      where: { projectId: ctx.projectId },
      orderBy: { version: 'desc' },
    });

    if (previous) {
      // Keep the superseded model as a restorable snapshot before replacing it.
      const oldElements = await this.prisma.element3D.findMany({
        where: { modelId: previous.id },
      });
      await this.projects.snapshot(
        ctx.projectId,
        this.service,
        `Modèle v${previous.version}`,
        { elements: oldElements },
        ctx.userId,
      );
      await this.prisma.model3D.delete({ where: { id: previous.id } });
    }

    const model = await this.prisma.model3D.create({
      data: {
        projectId: ctx.projectId,
        version: (previous?.version ?? 0) + 1,
        floors,
        status: 'ready',
      },
    });

    for (const element of extraction.items) {
      const sources = this.trace.normalizeSourceRefs(
        `model3d.${element.externalId}`,
        element.sources,
      );
      await this.prisma.element3D.create({
        data: {
          modelId: model.id,
          externalId: element.externalId,
          type: element.type,
          name: element.name || element.externalId,
          floor: element.floor,
          geometry: element.geometry as never,
          material: element.material,
          attributes: element.attributes as never,
          confidence: this.trace.coerceConfidence(element.confidence, sources),
          sourceRefs: sources as never,
        },
      });
    }

    await ctx.report(PipelineStep.VERIFICATION, 93, 'Vérification du modèle…');

    return { modelId: model.id, version: model.version, elements: extraction.items.length, floors };
  }

  /* ---------------------------------------------------------------- */
  /* Read                                                              */
  /* ---------------------------------------------------------------- */

  async read(projectId: string, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);

    const model = await this.prisma.model3D.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!model) {
      return { model: null, elements: [], history: [], floors: [] };
    }

    const [elements, history] = await Promise.all([
      this.prisma.element3D.findMany({
        where: { modelId: model.id },
        orderBy: [{ floor: 'asc' }, { type: 'asc' }, { externalId: 'asc' }],
      }),
      this.prisma.editHistory.findMany({
        where: { modelId: model.id },
        orderBy: { sequence: 'desc' },
        take: 100,
      }),
    ]);

    return {
      model,
      elements,
      history,
      floors: [...new Set(elements.map((e) => e.floor))],
    };
  }

  /* ---------------------------------------------------------------- */
  /* Chat-driven edit engine                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Turns an instruction into a *proposal* with a concrete diff. Nothing is
   * mutated here — the UI shows the diff behind Annuler / Appliquer.
   */
  async propose(
    projectId: string,
    organizationId: string,
    instruction: string,
    selectedIds: string[] = [],
  ): Promise<{ proposal: EditProposal | null; reply: string; clarificationIds: string[] }> {
    await this.projects.assertOwned(projectId, organizationId);
    const { model, elements, floors } = await this.read(projectId, organizationId);

    if (!model) {
      return {
        proposal: null,
        reply:
          "Aucun modèle 3D n'a encore été généré pour ce projet. Lancez d'abord l'analyse des plans.",
        clarificationIds: [],
      };
    }

    const result = await this.gateway.chat<EditProposal>(
      {
        projectId,
        organizationId,
        service: this.service,
        task: 'model3d.edit',
        instruction,
        history: [],
        context: {
          floors,
          selectedIds,
          elements: elements.slice(0, 400).map((e) => ({
            externalId: e.externalId,
            type: e.type,
            floor: e.floor,
            material: e.material,
            geometry: e.geometry,
          })),
        },
      },
      editProposalSchema,
    );

    if (!result.proposal) {
      return { proposal: null, reply: result.reply, clarificationIds: result.clarificationIds };
    }

    const diff = this.computeDiff(result.proposal.operations, elements);
    const proposal: EditProposal = {
      ...result.proposal,
      affectedCount: diff.length,
      diff,
    };

    if (diff.length === 0) {
      return {
        proposal: null,
        reply: `Aucun élément du modèle ne correspond à « ${instruction} ». Précisez le niveau ou le type d'élément visé.`,
        clarificationIds: result.clarificationIds,
      };
    }

    return { proposal, reply: result.reply, clarificationIds: result.clarificationIds };
  }

  /** Applies a confirmed proposal, storing the inverse operations for undo. */
  async apply(
    projectId: string,
    user: AuthUser,
    proposal: EditProposal,
    appliedBy: 'ai' | 'user' = 'ai',
  ) {
    await this.projects.assertOwned(projectId, user.organizationId);
    const model = await this.prisma.model3D.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!model) throw new NotFoundException('Aucun modèle 3D à modifier.');

    const elements = await this.prisma.element3D.findMany({ where: { modelId: model.id } });
    const inverse = this.buildInverse(proposal.operations, elements);

    for (const operation of proposal.operations) {
      await this.applyOperation(model.id, operation, user.id);
    }

    const last = await this.prisma.editHistory.findFirst({
      where: { modelId: model.id },
      orderBy: { sequence: 'desc' },
    });

    // Applying a new change after an undo discards the redo branch, which is
    // the behaviour users expect from a linear history.
    await this.prisma.editHistory.deleteMany({ where: { modelId: model.id, undone: true } });

    const entry = await this.prisma.editHistory.create({
      data: {
        modelId: model.id,
        sequence: (last?.sequence ?? 0) + 1,
        instructionNl: proposal.instruction,
        resolvedOperations: proposal.operations as never,
        inverseOperations: inverse as never,
        summary: proposal.summary,
        appliedBy,
        actorId: user.id,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId,
      actorId: user.id,
      actorType: appliedBy,
      service: this.service,
      action: 'model3d.edit.apply',
      entityType: 'EditHistory',
      entityId: entry.id,
      payload: { summary: proposal.summary, affected: proposal.affectedCount },
    });

    return { entry, ...(await this.read(projectId, user.organizationId)) };
  }

  async undo(projectId: string, user: AuthUser) {
    const model = await this.currentModel(projectId, user.organizationId);
    const entry = await this.prisma.editHistory.findFirst({
      where: { modelId: model.id, undone: false },
      orderBy: { sequence: 'desc' },
    });
    if (!entry) throw new NotFoundException('Aucune modification à annuler.');

    for (const operation of entry.inverseOperations as unknown as EditOperation[]) {
      await this.applyOperation(model.id, operation, user.id);
    }
    await this.prisma.editHistory.update({
      where: { id: entry.id },
      data: { undone: true },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId,
      actorId: user.id,
      service: this.service,
      action: 'model3d.edit.undo',
      entityType: 'EditHistory',
      entityId: entry.id,
    });

    return this.read(projectId, user.organizationId);
  }

  async redo(projectId: string, user: AuthUser) {
    const model = await this.currentModel(projectId, user.organizationId);
    const entry = await this.prisma.editHistory.findFirst({
      where: { modelId: model.id, undone: true },
      orderBy: { sequence: 'asc' },
    });
    if (!entry) throw new NotFoundException('Aucune modification à rétablir.');

    for (const operation of entry.resolvedOperations as unknown as EditOperation[]) {
      await this.applyOperation(model.id, operation, user.id);
    }
    await this.prisma.editHistory.update({
      where: { id: entry.id },
      data: { undone: false },
    });

    return this.read(projectId, user.organizationId);
  }

  /** Direct edit of one element from the detail panel. */
  async patchElement(
    elementId: string,
    user: AuthUser,
    patch: { field: string; value: unknown; reason?: string },
  ) {
    const element = await this.prisma.element3D.findFirst({
      where: { id: elementId, model: { project: { organizationId: user.organizationId } } },
      include: { model: true },
    });
    if (!element) throw new NotFoundException('Élément introuvable.');

    const geometry = element.geometry as unknown as BoxGeometry;
    const previousValue = this.readElementProperty(element, patch.field);
    const data: Record<string, unknown> = {};

    if (['height', 'width', 'depth'].includes(patch.field)) {
      const value = Number(patch.value);
      if (!Number.isFinite(value) || value <= 0) {
        throw new NotFoundException('Dimension invalide.');
      }
      data.geometry = this.withDimension(geometry, patch.field, value);
    } else if (patch.field === 'material' || patch.field === 'name') {
      data[patch.field] = String(patch.value ?? '');
    } else if (patch.field === 'visible') {
      data.visible = Boolean(patch.value);
    } else {
      throw new NotFoundException(`Champ « ${patch.field} » non modifiable.`);
    }

    const history = this.trace.appendCorrection(element.correctionHistory, {
      field: patch.field,
      previousValue,
      newValue: patch.value,
      previousConfidence: element.confidence as ConfidenceLevel,
      actorId: user.id,
      reason: patch.reason,
    });

    const updated = await this.prisma.element3D.update({
      where: { id: element.id },
      data: {
        ...data,
        confidence: ConfidenceLevel.USER_CONFIRMED,
        correctionHistory: history as never,
      } as never,
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId: element.model.projectId,
      actorId: user.id,
      service: this.service,
      action: 'model3d.element.patch',
      entityType: 'Element3D',
      entityId: element.id,
      payload: { field: patch.field, previousValue, newValue: patch.value },
    });

    void updated;
    return this.read(element.model.projectId, user.organizationId);
  }

  /* ---------------------------------------------------------------- */
  /* Operation machinery                                               */
  /* ---------------------------------------------------------------- */

  private matches(element: PrismaElement, selector: {
    types: string[];
    floors: string[];
    externalIds: string[];
  }): boolean {
    if (selector.externalIds.length > 0) {
      return selector.externalIds.includes(element.externalId);
    }
    if (selector.types.length > 0 && !selector.types.includes(element.type)) return false;
    if (selector.floors.length > 0 && !selector.floors.includes(element.floor)) return false;
    // An empty selector means "everything", which is only reachable when the
    // instruction itself was global.
    return true;
  }

  private computeDiff(operations: EditOperation[], elements: PrismaElement[]) {
    const diff: { externalId: string; property: string; before: unknown; after: unknown }[] = [];

    for (const operation of operations) {
      if (operation.op === 'set_property') {
        for (const element of elements.filter((e) => this.matches(e, operation.selector))) {
          diff.push({
            externalId: element.externalId,
            property: operation.property,
            before: this.readElementProperty(element, operation.property),
            after: operation.value,
          });
        }
      } else if (operation.op === 'set_visibility') {
        for (const element of elements.filter((e) => this.matches(e, operation.selector))) {
          if (element.visible === operation.visible) continue;
          diff.push({
            externalId: element.externalId,
            property: 'visible',
            before: element.visible,
            after: operation.visible,
          });
        }
      } else if (operation.op === 'remove_element') {
        for (const id of operation.externalIds) {
          if (elements.some((e) => e.externalId === id)) {
            diff.push({ externalId: id, property: 'existence', before: true, after: false });
          }
        }
      } else if (operation.op === 'add_element') {
        diff.push({
          externalId: operation.element.externalId ?? 'nouvel-élément',
          property: 'existence',
          before: false,
          after: true,
        });
      }
    }
    return diff;
  }

  /** Builds the operations that exactly reverse `operations` on current state. */
  private buildInverse(
    operations: EditOperation[],
    elements: PrismaElement[],
  ): EditOperation[] {
    const inverse: EditOperation[] = [];

    for (const operation of operations) {
      if (operation.op === 'set_property') {
        // Each affected element may have had a different previous value, so the
        // inverse is one targeted operation per element rather than one bulk op.
        for (const element of elements.filter((e) => this.matches(e, operation.selector))) {
          inverse.push({
            op: 'set_property',
            selector: { types: [], floors: [], externalIds: [element.externalId] },
            property: operation.property,
            value: this.readElementProperty(element, operation.property) as number | string,
          });
        }
      } else if (operation.op === 'set_visibility') {
        for (const element of elements.filter((e) => this.matches(e, operation.selector))) {
          inverse.push({
            op: 'set_visibility',
            selector: { types: [], floors: [], externalIds: [element.externalId] },
            visible: element.visible,
          });
        }
      } else if (operation.op === 'remove_element') {
        for (const id of operation.externalIds) {
          const element = elements.find((e) => e.externalId === id);
          if (!element) continue;
          inverse.push({
            op: 'add_element',
            element: {
              externalId: element.externalId,
              type: element.type as never,
              name: element.name,
              floor: element.floor,
              geometry: element.geometry as never,
              material: element.material,
              attributes: element.attributes as never,
              sources: this.trace.readSourceRefs(element.sourceRefs),
              confidence: element.confidence as ConfidenceLevel,
            },
          });
        }
      } else if (operation.op === 'add_element' && operation.element.externalId) {
        inverse.push({
          op: 'remove_element',
          externalIds: [operation.element.externalId],
        });
      }
    }
    return inverse.reverse();
  }

  private async applyOperation(
    modelId: string,
    operation: EditOperation,
    actorId: string,
  ): Promise<void> {
    const elements = await this.prisma.element3D.findMany({ where: { modelId } });

    if (operation.op === 'set_property') {
      for (const element of elements.filter((e) => this.matches(e, operation.selector))) {
        const data: Record<string, unknown> = {};
        if (['height', 'width', 'depth'].includes(operation.property)) {
          data.geometry = this.withDimension(
            element.geometry as unknown as BoxGeometry,
            operation.property,
            Number(operation.value),
          );
        } else {
          data[operation.property] = operation.value;
        }
        await this.prisma.element3D.update({
          where: { id: element.id },
          data: {
            ...data,
            correctionHistory: this.trace.appendCorrection(element.correctionHistory, {
              field: operation.property,
              previousValue: this.readElementProperty(element, operation.property),
              newValue: operation.value,
              previousConfidence: element.confidence as ConfidenceLevel,
              actorId,
            }) as never,
          } as never,
        });
      }
      return;
    }

    if (operation.op === 'set_visibility') {
      const ids = elements
        .filter((e) => this.matches(e, operation.selector))
        .map((e) => e.id);
      if (ids.length > 0) {
        await this.prisma.element3D.updateMany({
          where: { id: { in: ids } },
          data: { visible: operation.visible },
        });
      }
      return;
    }

    if (operation.op === 'remove_element') {
      await this.prisma.element3D.deleteMany({
        where: { modelId, externalId: { in: operation.externalIds } },
      });
      return;
    }

    if (operation.op === 'add_element') {
      const element = operation.element;
      if (!element.externalId || !element.geometry || !element.type) return;
      await this.prisma.element3D.upsert({
        where: { modelId_externalId: { modelId, externalId: element.externalId } },
        create: {
          modelId,
          externalId: element.externalId,
          type: element.type,
          name: element.name ?? element.externalId,
          floor: element.floor ?? 'RDC',
          geometry: element.geometry as never,
          material: element.material ?? 'beton',
          attributes: (element.attributes ?? {}) as never,
          confidence: element.confidence ?? ConfidenceLevel.USER_CONFIRMED,
          sourceRefs: (element.sources ?? []) as never,
        },
        update: {
          geometry: element.geometry as never,
          material: element.material ?? 'beton',
        },
      });
    }
  }

  private withDimension(
    geometry: BoxGeometry,
    property: string,
    value: number,
  ): BoxGeometry {
    const size: [number, number, number] = [...geometry.size];
    const position: [number, number, number] = [...geometry.position];
    const index = property === 'width' ? 0 : property === 'height' ? 1 : 2;

    if (index === 1) {
      // Walls sit on their floor slab: growing a wall must raise its centre by
      // half the delta, otherwise it sinks into the storey below.
      const delta = value - size[1];
      position[1] += delta / 2;
    }
    size[index] = value;
    return { ...geometry, size, position };
  }

  private readElementProperty(element: PrismaElement, property: string): unknown {
    const geometry = element.geometry as unknown as BoxGeometry;
    switch (property) {
      case 'width':
        return geometry.size[0];
      case 'height':
        return geometry.size[1];
      case 'depth':
        return geometry.size[2];
      case 'material':
        return element.material;
      case 'name':
        return element.name;
      case 'visible':
        return element.visible;
      default:
        return null;
    }
  }

  private async currentModel(projectId: string, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);
    const model = await this.prisma.model3D.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    if (!model) throw new NotFoundException('Aucun modèle 3D pour ce projet.');
    return model;
  }
}
