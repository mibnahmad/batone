import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export type AuditActorType = 'user' | 'ai' | 'system';

export interface AuditInput {
  organizationId: string;
  projectId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  service?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: unknown;
}

/**
 * Every state change that a customer could later challenge ("where did this
 * number come from?") is recorded here. Writes are best-effort and must never
 * fail the originating request.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId ?? null,
          actorId: input.actorId ?? null,
          actorType: input.actorType ?? 'user',
          service: input.service ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          payload: (input.payload ?? null) as never,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit event ${input.action}: ${String(err)}`);
    }
  }

  async listForProject(projectId: string, limit = 200) {
    return this.prisma.auditEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
