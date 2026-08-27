import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProjectDto, ServiceId } from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../auth/auth.decorators';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { documents: true, takeoffLines: true, clarifications: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return projects.map((project) => ({
      ...project,
      documentCount: project._count.documents,
      takeoffLineCount: project._count.takeoffLines,
      clarificationCount: project._count.clarifications,
    }));
  }

  async create(user: AuthUser, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        organizationId: user.organizationId,
        createdById: user.id,
        name: dto.name,
        reference: dto.reference ?? null,
        client: dto.client ?? null,
        location: dto.location ?? null,
        description: dto.description ?? null,
        services: dto.services,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId: project.id,
      actorId: user.id,
      action: 'project.create',
      entityType: 'Project',
      entityId: project.id,
      payload: { services: dto.services },
    });

    return project;
  }

  async get(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        documents: {
          orderBy: [{ kind: 'asc' }, { orderIndex: 'asc' }],
          select: {
            id: true,
            kind: true,
            format: true,
            originalName: true,
            label: true,
            floor: true,
            orderIndex: true,
            sizeBytes: true,
            parseStatus: true,
            parseError: true,
            createdAt: true,
          },
        },
        jobs: { orderBy: { createdAt: 'desc' }, take: 20 },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!project) throw new NotFoundException('Projet introuvable.');

    const openClarifications = await this.prisma.clarification.groupBy({
      by: ['service'],
      where: { projectId, status: 'open' },
      _count: { _all: true },
    });

    return {
      ...project,
      openClarificationsByService: Object.fromEntries(
        openClarifications.map((row) => [row.service, row._count._all]),
      ),
    };
  }

  async remove(projectId: string, user: AuthUser) {
    await this.assertOwned(projectId, user.organizationId);
    await this.prisma.project.delete({ where: { id: projectId } });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'project.delete',
      entityType: 'Project',
      entityId: projectId,
    });
    return { ok: true };
  }

  /** Ownership check used by every service module before touching project data. */
  async assertOwned(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException('Projet introuvable.');
    return project;
  }

  async assertServiceEnabled(projectId: string, organizationId: string, service: ServiceId) {
    const project = await this.assertOwned(projectId, organizationId);
    if (!project.services.includes(service)) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { services: { push: service } },
      });
    }
    return project;
  }

  /** Snapshots current state so a user can restore after an unwanted change. */
  async snapshot(
    projectId: string,
    service: ServiceId,
    label: string,
    snapshot: unknown,
    createdBy: string,
  ) {
    return this.prisma.projectVersion.create({
      data: {
        projectId,
        service,
        label,
        snapshot: snapshot as never,
        createdBy,
      },
    });
  }

  async versions(projectId: string, service?: ServiceId) {
    return this.prisma.projectVersion.findMany({
      where: { projectId, ...(service ? { service } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, service: true, label: true, createdAt: true, createdBy: true },
    });
  }
}
