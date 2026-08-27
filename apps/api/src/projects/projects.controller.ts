import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { createProjectSchema, ServiceId, type CreateProjectDto } from '@batione/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.organizationId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto,
  ) {
    return this.projects.create(user, dto);
  }

  @Get(':projectId')
  get(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.projects.get(projectId, user.organizationId);
  }

  @Delete(':projectId')
  remove(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.projects.remove(projectId, user);
  }

  @Get(':projectId/audit')
  async auditTrail(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    await this.projects.assertOwned(projectId, user.organizationId);
    return this.audit.listForProject(projectId);
  }

  @Get(':projectId/versions')
  async versions(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Query('service') service?: string,
  ) {
    await this.projects.assertOwned(projectId, user.organizationId);
    return this.projects.versions(projectId, service as ServiceId | undefined);
  }
}
