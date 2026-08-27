import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { runServiceSchema, ServiceId, type RunServiceDto } from '@batione/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ProjectsService } from '../projects/projects.service';
import { JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
  ) {}

  @Post('projects/:projectId/run')
  async run(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(runServiceSchema)) dto: RunServiceDto,
  ) {
    await this.projects.assertServiceEnabled(projectId, user.organizationId, dto.service);
    return this.jobs.create({
      projectId,
      organizationId: user.organizationId,
      userId: user.id,
      service: dto.service,
      documentIds: dto.documentIds,
      options: dto.options,
    });
  }

  @Get('projects/:projectId/jobs')
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Query('service') service?: string,
  ) {
    await this.projects.assertOwned(projectId, user.organizationId);
    return this.jobs.listForProject(projectId, service as ServiceId | undefined);
  }

  @Get('jobs/:jobId')
  get(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.jobs.get(jobId, user.organizationId);
  }

  /**
   * Server-Sent Events feed powering the workspace stepper. The bearer token is
   * accepted from the query string because EventSource cannot set headers.
   */
  @Get('jobs/:jobId/stream')
  async stream(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.jobs.get(jobId, user.organizationId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const initial = await this.jobs.progressOf(jobId);
    if (initial) send(initial);

    const unsubscribe = this.jobs.subscribe(jobId, send);
    // Proxies drop idle SSE connections; a periodic comment keeps them open.
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }
}
