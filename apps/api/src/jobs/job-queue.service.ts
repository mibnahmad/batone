import { EventEmitter } from 'node:events';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

export interface QueuedJob {
  jobId: string;
}

export type JobProcessor = (jobId: string) => Promise<void>;

/**
 * Job transport abstraction.
 *
 * Plan parsing, OCR and 3D generation are long-running, so nothing runs inside a
 * request. Job *state* lives in Postgres (durable, queryable, auditable); this
 * class only decides where the work is dispatched. Redis/BullMQ is used when
 * available and an in-process queue is the automatic fallback, which keeps a
 * fresh `npm run dev` working with zero external services.
 */
@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly emitter = new EventEmitter();
  private processor: JobProcessor | null = null;

  private queue: Queue<QueuedJob> | null = null;
  private worker: Worker<QueuedJob> | null = null;
  private mode: 'redis' | 'in-process' = 'in-process';

  /** Simple FIFO with bounded concurrency for the in-process fallback. */
  private readonly pending: string[] = [];
  private active = 0;
  private readonly concurrency: number;

  constructor(private readonly config: ConfigService) {
    this.emitter.setMaxListeners(0);
    this.concurrency = Number(this.config.get('JOB_CONCURRENCY') ?? 2);
  }

  register(processor: JobProcessor): void {
    this.processor = processor;
    void this.initRedis();
  }

  private async initRedis(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url || this.config.get('JOB_QUEUE') === 'in-process') {
      this.logger.log("File d'attente : en mémoire (mono-processus).");
      return;
    }

    try {
      const connection = this.parseRedisUrl(url);
      const queue = new Queue<QueuedJob>('batione-jobs', { connection });
      // `waitUntilReady` surfaces an unreachable Redis immediately instead of
      // silently swallowing every enqueued job.
      await queue.waitUntilReady();

      const worker = new Worker<QueuedJob>(
        'batione-jobs',
        async (job) => {
          if (this.processor) await this.processor(job.data.jobId);
        },
        { connection, concurrency: this.concurrency },
      );
      worker.on('failed', (job, err) => {
        this.logger.error(`Job ${job?.data?.jobId} échoué : ${err.message}`);
      });

      this.queue = queue;
      this.worker = worker;
      this.mode = 'redis';
      this.logger.log(`File d'attente : Redis (concurrence ${this.concurrency}).`);
    } catch (err) {
      this.logger.warn(
        `Redis indisponible (${String(err)}) — bascule sur la file en mémoire.`,
      );
      this.queue = null;
      this.worker = null;
      this.mode = 'in-process';
    }
  }

  private parseRedisUrl(url: string): ConnectionOptions {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      ...(parsed.password ? { password: parsed.password } : {}),
      maxRetriesPerRequest: null,
    };
  }

  async enqueue(jobId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add('run', { jobId }, { removeOnComplete: 100, removeOnFail: 100 });
      return;
    }
    this.pending.push(jobId);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const jobId = this.pending.shift() as string;
      this.active += 1;
      void (async () => {
        try {
          if (this.processor) await this.processor(jobId);
        } catch (err) {
          this.logger.error(`Job ${jobId} échoué : ${String(err)}`);
        } finally {
          this.active -= 1;
          this.drain();
        }
      })();
    }
  }

  /* --------------------- progress fan-out for SSE --------------------- */

  publish(jobId: string, payload: unknown): void {
    this.emitter.emit(`job:${jobId}`, payload);
    this.emitter.emit('job:*', payload);
  }

  subscribe(jobId: string, listener: (payload: unknown) => void): () => void {
    const channel = `job:${jobId}`;
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  get transport(): string {
    return this.mode;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
