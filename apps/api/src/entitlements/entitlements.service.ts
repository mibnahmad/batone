import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntitlementView,
  SERVICE_IDS,
  SERVICE_LABELS,
  SERVICE_QUOTA_UNIT,
  ServiceId,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

/**
 * Raised when a service's quota is exhausted. Mapped to HTTP 402 so the frontend
 * can distinguish "you must buy more of THIS service" from a generic denial —
 * the other three services must keep working.
 */
export class QuotaExhaustedException extends HttpException {
  constructor(service: ServiceId, quotaTotal: number) {
    super(
      {
        error: 'quota_exhausted',
        service,
        quotaTotal,
        message: `Quota épuisé pour le service « ${SERVICE_LABELS[service]} » (${quotaTotal} ${SERVICE_QUOTA_UNIT[service]}). Les autres services restent disponibles.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<EntitlementView[]> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { entitlements: true },
    });

    return SERVICE_IDS.map((service) => {
      const row = subscription?.entitlements.find((e) => e.service === service);
      return {
        service,
        label: SERVICE_LABELS[service],
        unit: SERVICE_QUOTA_UNIT[service],
        quotaTotal: row?.quotaTotal ?? 0,
        quotaUsed: row?.quotaUsed ?? 0,
        status: (row?.status as EntitlementView['status']) ?? 'inactive',
        periodEnd: subscription?.periodEnd.toISOString() ?? null,
      };
    });
  }

  /**
   * Verifies the organization may run `service` right now, without consuming.
   * Deliberately scoped to a single service so exhausting one never cascades.
   */
  async assertAvailable(organizationId: string, service: ServiceId, amount = 1) {
    const entitlement = await this.findEntitlement(organizationId, service);
    if (entitlement.status === 'inactive') {
      throw new ForbiddenException(
        `Le service « ${SERVICE_LABELS[service]} » n'est pas inclus dans votre abonnement.`,
      );
    }
    if (entitlement.quotaUsed + amount > entitlement.quotaTotal) {
      throw new QuotaExhaustedException(service, entitlement.quotaTotal);
    }
    return entitlement;
  }

  /**
   * Atomically consumes quota. The conditional update means two concurrent jobs
   * cannot both slip through on the last remaining credit.
   */
  async consume(
    organizationId: string,
    service: ServiceId,
    amount: number,
    context: { projectId?: string; jobId?: string; reason: string },
  ) {
    const entitlement = await this.assertAvailable(organizationId, service, amount);

    const updated = await this.prisma.serviceEntitlement.updateMany({
      where: {
        id: entitlement.id,
        quotaUsed: { lte: entitlement.quotaTotal - amount },
      },
      data: { quotaUsed: { increment: amount } },
    });

    if (updated.count === 0) {
      throw new QuotaExhaustedException(service, entitlement.quotaTotal);
    }

    await this.prisma.quotaConsumption.create({
      data: {
        entitlementId: entitlement.id,
        projectId: context.projectId ?? null,
        jobId: context.jobId ?? null,
        amount,
        reason: context.reason,
      },
    });

    const refreshed = await this.prisma.serviceEntitlement.findUniqueOrThrow({
      where: { id: entitlement.id },
    });
    if (refreshed.quotaUsed >= refreshed.quotaTotal && refreshed.status === 'active') {
      await this.prisma.serviceEntitlement.update({
        where: { id: refreshed.id },
        data: { status: 'exhausted' },
      });
    }

    await this.audit.record({
      organizationId,
      projectId: context.projectId,
      actorType: 'system',
      service,
      action: 'entitlement.consume',
      entityType: 'ServiceEntitlement',
      entityId: entitlement.id,
      payload: { amount, reason: context.reason, quotaUsed: refreshed.quotaUsed },
    });

    return refreshed;
  }

  /** Returns quota when a job fails, so customers are not billed for our errors. */
  async refund(
    organizationId: string,
    service: ServiceId,
    amount: number,
    reason: string,
  ) {
    const entitlement = await this.findEntitlement(organizationId, service).catch(() => null);
    if (!entitlement) return;

    await this.prisma.serviceEntitlement.update({
      where: { id: entitlement.id },
      data: {
        quotaUsed: { decrement: Math.min(amount, entitlement.quotaUsed) },
        status: 'active',
      },
    });
    await this.prisma.quotaConsumption.create({
      data: { entitlementId: entitlement.id, amount: -amount, reason },
    });
  }

  private async findEntitlement(organizationId: string, service: ServiceId) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { entitlements: { where: { service } } },
    });
    if (!subscription) {
      throw new NotFoundException('Aucun abonnement actif pour cette organisation.');
    }
    const entitlement = subscription.entitlements[0];
    if (!entitlement) {
      throw new ForbiddenException(
        `Le service « ${SERVICE_LABELS[service]} » n'est pas inclus dans votre abonnement.`,
      );
    }
    return entitlement;
  }
}
