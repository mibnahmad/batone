import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  JobProgress,
  JobStatus,
  PIPELINE_ORDER,
  PipelineStep,
  ServiceId,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { ClarificationService } from '../ai/clarification.service';
import { JobQueueService } from './job-queue.service';

/** Contract implemented by each service engine so the runner stays generic. */
export interface ServiceEngine {
  readonly service: ServiceId;
  run(ctx: JobContext): Promise<unknown>;
}

export interface JobContext {
  jobId: string;
  projectId: string;
  organizationId: string;
  userId: string;
  service: ServiceId;
  documentIds: string[];
  options: Record<string, unknown>;
  /** Reports progress; the value is streamed to the workspace stepper. */
  report(step: PipelineStep, progress: number, message?: string): Promise<void>;
}

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly engines = new Map<ServiceId, ServiceEngine>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly entitlements: EntitlementsService,
    private readonly clarifications: ClarificationService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.queue.register((jobId) => this.execute(jobId));
  }

  registerEngine(engine: ServiceEngine): void {
    this.engines.set(engine.service, engine);
  }

  async create(input: {
    projectId: string;
    organizationId: string;
    userId: string;
    service: ServiceId;
    documentIds: string[];
    options: Record<string, unknown>;
  }) {
    // Quota is checked before the job exists so an exhausted service never even
    // creates a queue entry, and the other services stay unaffected.
    await this.entitlements.assertAvailable(input.organizationId, input.service, 1);

    const job = await this.prisma.job.create({
      data: {
        projectId: input.projectId,
        service: input.service,
        type: `${input.service}.run`,
        status: JobStatus.QUEUED,
        step: PipelineStep.IMPORT,
        progress: 0,
        input: {
          documentIds: input.documentIds,
          options: input.options,
          userId: input.userId,
          organizationId: input.organizationId,
        } as never,
      },
    });

    await this.queue.enqueue(job.id);
    await this.publishProgress(job.id);
    return job;
  }

  async execute(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Job ${jobId} introuvable.`);
      return;
    }

    const meta = (job.input ?? {}) as {
      documentIds?: string[];
      options?: Record<string, unknown>;
      userId?: string;
      organizationId?: string;
    };
    const service = job.service as ServiceId;
    const engine = this.engines.get(service);

    if (!engine) {
      await this.fail(jobId, `Aucun moteur enregistré pour le service ${service}.`);
      return;
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        step: PipelineStep.IMPORT,
        progress: 2,
        error: null,
      },
    });
    await this.publishProgress(jobId);

    let quotaConsumed = false;
    try {
      await this.entitlements.consume(
        meta.organizationId as string,
        service,
        1,
        { projectId: job.projectId, jobId, reason: `${service}.run` },
      );
      quotaConsumed = true;

      // Questions from the previous run are re-derived by this one.
      await this.clarifications.supersedeOpen(job.projectId, service);

      const ctx: JobContext = {
        jobId,
        projectId: job.projectId,
        organizationId: meta.organizationId as string,
        userId: meta.userId as string,
        service,
        documentIds: meta.documentIds ?? [],
        options: meta.options ?? {},
        report: (step, progress, message) => this.report(jobId, step, progress, message),
      };

      const result = await engine.run(ctx);

      const openQuestions = await this.clarifications.countOpen(job.projectId, service);
      // A pipeline that produced blocking questions is *not* "succeeded": the
      // stepper must show it stopped at Vérification awaiting the user.
      const finalStatus = openQuestions > 0 ? JobStatus.BLOCKED : JobStatus.SUCCEEDED;
      const finalStep =
        openQuestions > 0 ? PipelineStep.VERIFICATION : PipelineStep.DONE;

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: finalStatus,
          step: finalStep,
          progress: 100,
          endedAt: new Date(),
          result: (result ?? null) as never,
          message:
            openQuestions > 0
              ? `${openQuestions} point(s) à clarifier avant finalisation.`
              : 'Traitement terminé.',
        },
      });
      await this.publishProgress(jobId);

      await this.audit.record({
        organizationId: meta.organizationId as string,
        projectId: job.projectId,
        actorType: 'system',
        service,
        action: 'job.complete',
        entityType: 'Job',
        entityId: jobId,
        payload: { status: finalStatus, openQuestions },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} échoué : ${message}`);
      if (quotaConsumed && meta.organizationId) {
        await this.entitlements.refund(
          meta.organizationId,
          service,
          1,
          `Remboursement — échec du job ${jobId}`,
        );
      }
      await this.fail(jobId, message);
    }
  }

  private async report(
    jobId: string,
    step: PipelineStep,
    progress: number,
    message?: string,
  ): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        step,
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        message: message ?? null,
      },
    });
    await this.publishProgress(jobId);
  }

  private async fail(jobId: string, error: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.FAILED, error, endedAt: new Date(), progress: 100 },
    });
    await this.publishProgress(jobId);
  }

  async get(jobId: string, organizationId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, project: { organizationId } },
    });
    if (!job) throw new NotFoundException('Job introuvable.');
    return job;
  }

  async listForProject(projectId: string, service?: ServiceId) {
    return this.prisma.job.findMany({
      where: { projectId, ...(service ? { service } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async progressOf(jobId: string): Promise<JobProgress | null> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return null;
    const openClarifications = await this.clarifications.countOpen(
      job.projectId,
      job.service as ServiceId,
    );
    return {
      jobId: job.id,
      projectId: job.projectId,
      service: job.service as ServiceId,
      status: job.status as JobStatus,
      step: job.step as PipelineStep,
      progress: job.progress,
      message: job.message ?? undefined,
      error: job.error ?? undefined,
      openClarifications,
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private async publishProgress(jobId: string): Promise<void> {
    const progress = await this.progressOf(jobId);
    if (progress) this.queue.publish(jobId, progress);
  }

  subscribe(jobId: string, listener: (payload: unknown) => void): () => void {
    return this.queue.subscribe(jobId, listener);
  }

  /** Percentage boundaries for each pipeline step, used by the engines. */
  static stepProgress(step: PipelineStep): number {
    const index = PIPELINE_ORDER.indexOf(step);
    return Math.round(((index + 1) / PIPELINE_ORDER.length) * 100);
  }
}
