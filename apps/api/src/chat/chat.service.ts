import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ConfidenceLevel,
  editProposalSchema,
  ServiceId,
  SERVICE_LABELS,
  type EditProposal,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { ClarificationService } from '../ai/clarification.service';
import { ProjectsService } from '../projects/projects.service';
import { Model3DService } from '../services/model3d/model3d.service';
import { AuthUser } from '../auth/auth.decorators';

/**
 * One chat session per (project, service). The assistant is deliberately
 * grounded: for 2D→3D it resolves an instruction into a *proposed* structured
 * operation that the user must confirm, and for the table-based services it
 * answers from persisted state only — it never produces a new technical value
 * outside the pipeline that would bypass source binding.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly clarifications: ClarificationService,
    private readonly projects: ProjectsService,
    private readonly model3d: Model3DService,
  ) {}

  async session(projectId: string, service: ServiceId, organizationId: string) {
    await this.projects.assertOwned(projectId, organizationId);
    const existing = await this.prisma.chatSession.findUnique({
      where: { projectId_service: { projectId, service } },
    });
    if (existing) return existing;

    const session = await this.prisma.chatSession.create({
      data: { projectId, service, title: `Assistant ${SERVICE_LABELS[service]}` },
    });
    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: this.welcome(service),
      },
    });
    return session;
  }

  async history(projectId: string, service: ServiceId, organizationId: string) {
    const session = await this.session(projectId, service, organizationId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const openClarifications = await this.clarifications.list(projectId, service, 'open' as never);
    return { session, messages, openClarifications };
  }

  async send(
    projectId: string,
    service: ServiceId,
    user: AuthUser,
    input: { content: string; selectedIds?: string[] },
  ) {
    const session = await this.session(projectId, service, user.organizationId);

    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        userId: user.id,
        role: 'user',
        content: input.content,
      },
    });

    const previous = await this.prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    const history = previous
      .reverse()
      .map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      }));

    if (service === ServiceId.MODEL_3D) {
      const outcome = await this.model3d.propose(
        projectId,
        user.organizationId,
        input.content,
        input.selectedIds ?? [],
      );

      const assistant = await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content:
            outcome.proposal && !/appliquer cette modification/i.test(outcome.reply)
              ? `${outcome.reply}\n\nSouhaitez-vous appliquer cette modification ?`
              : outcome.reply,
          proposal: (outcome.proposal ?? undefined) as never,
          entityRefs: (outcome.proposal?.diff?.map((d) => d.externalId) ?? []) as never,
        },
      });

      return {
        message: assistant,
        messages: await this.messagesOf(session.id),
        proposal: outcome.proposal,
        clarificationIds: outcome.clarificationIds,
      };
    }

    const context = await this.stateContext(projectId, service);
    const result = await this.gateway.chat(
      {
        projectId,
        organizationId: user.organizationId,
        service,
        task: `${service}.chat`,
        instruction: input.content,
        history,
        context,
      },
      editProposalSchema.optional() as never,
    );

    const assistant = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: result.reply || this.fallbackAnswer(service, context),
      },
    });

    return {
      message: assistant,
      messages: await this.messagesOf(session.id),
      proposal: null,
      clarificationIds: result.clarificationIds,
    };
  }

  /** Confirms the proposal attached to an assistant message (Appliquer). */
  async applyProposal(messageId: string, user: AuthUser) {
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        session: { project: { organizationId: user.organizationId } },
      },
      include: { session: true },
    });
    if (!message?.proposal) throw new NotFoundException('Aucune proposition à appliquer.');

    const proposal = editProposalSchema.parse(message.proposal) as EditProposal;
    const applied = await this.model3d.apply(message.session.projectId, user, proposal, 'ai');

    await this.prisma.chatMessage.update({
      where: { id: message.id },
      data: { proposal: { ...(message.proposal as object), status: 'applied' } as never },
    });

    const confirmation = await this.prisma.chatMessage.create({
      data: {
        sessionId: message.sessionId,
        role: 'assistant',
        content: `Modification appliquée : ${proposal.summary} (${proposal.affectedCount} élément(s)). Vous pouvez l'annuler à tout moment.`,
      },
    });

    return {
      message: confirmation,
      messages: await this.messagesOf(message.sessionId),
      model: applied,
    };
  }

  /** Rejects the proposal (Annuler) — nothing is written to the model. */
  async discardProposal(messageId: string, user: AuthUser) {
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        session: { project: { organizationId: user.organizationId } },
      },
    });
    if (!message?.proposal) throw new NotFoundException('Aucune proposition à annuler.');

    await this.prisma.chatMessage.update({
      where: { id: message.id },
      data: { proposal: { ...(message.proposal as object), status: 'discarded' } as never },
    });

    const notice = await this.prisma.chatMessage.create({
      data: {
        sessionId: message.sessionId,
        role: 'assistant',
        content: 'Modification abandonnée. Le modèle est inchangé.',
      },
    });

    return { message: notice, messages: await this.messagesOf(message.sessionId) };
  }

  private messagesOf(sessionId: string) {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /**
   * The assistant may only speak about state that already exists in the
   * database, which is what keeps chat answers traceable.
   */
  private async stateContext(projectId: string, service: ServiceId) {
    const openClarifications = await this.clarifications.countOpen(projectId, service);

    if (service === ServiceId.TAKEOFF) {
      const lines = await this.prisma.takeoffLine.findMany({ where: { projectId }, take: 400 });
      return {
        openClarifications,
        lineCount: lines.length,
        floors: [...new Set(lines.map((line) => line.floor))],
        categories: [...new Set(lines.map((line) => line.category))],
        hypotheses: lines.filter((l) => l.confidence === ConfidenceLevel.HYPOTHESIS).length,
        lines: lines.slice(0, 120).map((line) => ({
          ouvrage: line.ouvrage,
          description: line.description,
          category: line.category,
          floor: line.floor,
          unit: line.unit,
          quantity: line.quantity,
          confidence: line.confidence,
          sourceCount: Array.isArray(line.sourceRefs) ? line.sourceRefs.length : 0,
          clauseCount: line.clauseIds.length,
          corrections: Array.isArray(line.correctionHistory)
            ? line.correctionHistory.length
            : 0,
        })),
      };
    }

    if (service === ServiceId.REBAR) {
      const elements = await this.prisma.structuralElement.findMany({
        where: { projectId },
        include: { rebarLines: true },
        take: 200,
      });
      return {
        openClarifications,
        elementCount: elements.length,
        totalWeight: elements
          .flatMap((element) => element.rebarLines)
          .reduce((sum, line) => sum + line.totalWeightKg, 0),
        ruleSets: [
          ...new Set(
            elements.flatMap((e) =>
              e.rebarLines.map((l) => `${l.ruleId.split(':').pop()}@${l.ruleVersion}`),
            ),
          ),
        ],
        elements: elements.map((element) => ({
          reference: element.reference,
          type: element.type,
          floor: element.floor,
          bars: element.rebarLines.length,
          weightKg:
            Math.round(
              element.rebarLines.reduce((sum, l) => sum + l.totalWeightKg, 0) * 1000,
            ) / 1000,
          lines: element.rebarLines.map((l) => ({
            role: l.role,
            diameterMm: l.diameterMm,
            count: l.count,
            unitLengthM: l.unitLengthM,
            totalWeightKg: l.totalWeightKg,
            computation: l.computation,
            confidence: l.confidence,
          })),
        })),
      };
    }

    const study = await this.prisma.priceStudy.findFirst({
      where: { projectId },
      include: { items: true },
    });
    return {
      openClarifications,
      itemCount: study?.items.length ?? 0,
      breakdown: study?.breakdown ?? null,
      currency: study?.currency ?? 'EUR',
      items: (study?.items ?? []).slice(0, 120).map((item) => ({
        designation: item.designation,
        category: item.category,
        unit: item.unit,
        quantity: item.quantity,
        unitPriceMaterials: item.unitPriceMaterials,
        unitPriceLabour: item.unitPriceLabour,
        unitPriceEquipment: item.unitPriceEquipment,
        total: item.total,
        confidence: item.confidence,
      })),
    };
  }

  private fallbackAnswer(service: ServiceId, context: Record<string, unknown>): string {
    return `Je ne dispose pas d'information supplémentaire dans les documents du projet pour répondre précisément. État actuel du service ${SERVICE_LABELS[service]} : ${JSON.stringify(
      {
        ...context,
        lines: undefined,
        items: undefined,
        elements: undefined,
      },
    )}`;
  }

  private welcome(service: ServiceId): string {
    switch (service) {
      case ServiceId.MODEL_3D:
        return "Bonjour ! Décrivez la modification souhaitée (par exemple « Augmente la hauteur des murs du RDC à 3,20 m ») et je vous proposerai le changement avant de l'appliquer.";
      case ServiceId.TAKEOFF:
        return "Bonjour ! Posez vos questions sur le métré : origine d'une quantité, clause du CCTP associée, filtre par niveau ou par lot.";
      case ServiceId.REBAR:
        return 'Bonjour ! Interrogez-moi sur le ferraillage : aciers par élément, par diamètre, règle de calcul appliquée.';
      default:
        return "Bonjour ! Interrogez-moi sur l'étude de prix : sous-totaux, hypothèses retenues, formule de marge appliquée.";
    }
  }
}
