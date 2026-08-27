import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ClarificationRequest,
  ClarificationStatus,
  ConfidenceLevel,
  ServiceId,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../auth/auth.decorators';

/**
 * Turns "I don't know" into a first-class, blocking artefact.
 *
 * A clarification names the exact field it blocks (`targetPath`). Services query
 * `blockedPaths()` before finalizing a result, which is what makes the product
 * rule enforceable rather than aspirational.
 */
@Injectable()
export class ClarificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async persist(
    projectId: string,
    service: ServiceId,
    requests: ClarificationRequest[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const request of requests) {
      // Re-asking an identical open question on every re-run would be noise.
      const existing = await this.prisma.clarification.findFirst({
        where: {
          projectId,
          service,
          targetPath: request.targetPath,
          status: ClarificationStatus.OPEN,
        },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await this.prisma.clarification.create({
        data: {
          projectId,
          service,
          kind: request.kind,
          targetPath: request.targetPath,
          question: request.question,
          options: request.options,
          sourceRefs: request.sources as never,
          status: ClarificationStatus.OPEN,
        },
      });
      ids.push(created.id);
    }
    return ids;
  }

  /**
   * A re-run re-reads the documents from scratch, so questions raised by the
   * previous run must not survive it: a stale open question would keep a value
   * blocked even after the underlying ambiguity disappeared. Answered ones are
   * kept — they are user decisions, not engine output.
   */
  async supersedeOpen(projectId: string, service: ServiceId): Promise<number> {
    const { count } = await this.prisma.clarification.updateMany({
      where: { projectId, service, status: ClarificationStatus.OPEN },
      data: { status: ClarificationStatus.DISMISSED },
    });
    return count;
  }

  async list(projectId: string, service?: ServiceId, status?: ClarificationStatus) {
    return this.prisma.clarification.findMany({
      where: {
        projectId,
        ...(service ? { service } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Paths currently blocked from finalization for a service. */
  async blockedPaths(projectId: string, service: ServiceId): Promise<Set<string>> {
    const open = await this.prisma.clarification.findMany({
      where: { projectId, service, status: ClarificationStatus.OPEN },
      select: { targetPath: true },
    });
    return new Set(open.map((c) => c.targetPath));
  }

  async countOpen(projectId: string, service?: ServiceId): Promise<number> {
    return this.prisma.clarification.count({
      where: { projectId, ...(service ? { service } : {}), status: ClarificationStatus.OPEN },
    });
  }

  async answer(clarificationId: string, user: AuthUser, answer: string) {
    const clarification = await this.findOwned(clarificationId, user.organizationId);

    const updated = await this.prisma.clarification.update({
      where: { id: clarification.id },
      data: {
        status: ClarificationStatus.ANSWERED,
        answer,
        answeredBy: user.id,
        answeredAt: new Date(),
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId: clarification.projectId,
      actorId: user.id,
      service: clarification.service,
      action: 'clarification.answer',
      entityType: 'Clarification',
      entityId: clarification.id,
      payload: { targetPath: clarification.targetPath, answer },
    });

    return updated;
  }

  /**
   * The user acknowledges the gap and accepts the stated hypothesis. The value
   * stays flagged as a hypothesis — dismissing a question never upgrades data.
   */
  async dismiss(clarificationId: string, user: AuthUser) {
    const clarification = await this.findOwned(clarificationId, user.organizationId);
    const updated = await this.prisma.clarification.update({
      where: { id: clarification.id },
      data: {
        status: ClarificationStatus.DISMISSED,
        answeredBy: user.id,
        answeredAt: new Date(),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      projectId: clarification.projectId,
      actorId: user.id,
      service: clarification.service,
      action: 'clarification.dismiss',
      entityType: 'Clarification',
      entityId: clarification.id,
      payload: { targetPath: clarification.targetPath },
    });
    return updated;
  }

  /**
   * Interprets a user's answer as a numeric value when the question was about a
   * dimension. Returns null when the answer is not numeric, in which case the
   * caller keeps the value blocked rather than guessing again.
   */
  parseNumericAnswer(answer: string): number | null {
    const match = /(-?\d+(?:[.,]\d+)?)/.exec(answer);
    if (!match) return null;
    const value = Number.parseFloat(match[1].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  /** Answered clarifications become user-confirmed values. */
  async resolvedValues(
    projectId: string,
    service: ServiceId,
  ): Promise<Map<string, { value: string; numeric: number | null; confidence: ConfidenceLevel }>> {
    const answered = await this.prisma.clarification.findMany({
      where: { projectId, service, status: ClarificationStatus.ANSWERED },
    });
    const map = new Map<
      string,
      { value: string; numeric: number | null; confidence: ConfidenceLevel }
    >();
    for (const row of answered) {
      if (!row.answer) continue;
      map.set(row.targetPath, {
        value: row.answer,
        numeric: this.parseNumericAnswer(row.answer),
        confidence: ConfidenceLevel.USER_CONFIRMED,
      });
    }
    return map;
  }

  private async findOwned(clarificationId: string, organizationId: string) {
    const row = await this.prisma.clarification.findFirst({
      where: { id: clarificationId, project: { organizationId } },
    });
    if (!row) throw new NotFoundException('Question de clarification introuvable.');
    return row;
  }
}
