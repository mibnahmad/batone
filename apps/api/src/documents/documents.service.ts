import { extname } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentKind,
  SUPPORTED_UPLOAD_EXTENSIONS,
  UploadDocumentMetaDto,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../auth/auth.decorators';
import { DocumentProcessingService } from './document-processing.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly processing: DocumentProcessingService,
  ) {}

  async list(projectId: string, organizationId: string) {
    await this.assertProject(projectId, organizationId);
    return this.prisma.projectDocument.findMany({
      where: { projectId },
      orderBy: [{ kind: 'asc' }, { orderIndex: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        format: true,
        originalName: true,
        sizeBytes: true,
        floor: true,
        label: true,
        orderIndex: true,
        parseStatus: true,
        parseError: true,
        createdAt: true,
      },
    });
  }

  async upload(
    projectId: string,
    user: AuthUser,
    file: Express.Multer.File,
    meta: UploadDocumentMetaDto,
  ) {
    await this.assertProject(projectId, user.organizationId);

    const ext = extname(file.originalname).toLowerCase();
    if (!(SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new BadRequestException(
        `Format non pris en charge : ${ext || 'inconnu'}. Formats acceptés : ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }

    const key = this.storage.buildKey(user.organizationId, projectId, file.originalname);
    await this.storage.put(key, file.buffer);

    const maxOrder = await this.prisma.projectDocument.aggregate({
      where: { projectId, kind: meta.kind },
      _max: { orderIndex: true },
    });

    const document = await this.prisma.projectDocument.create({
      data: {
        projectId,
        kind: meta.kind,
        format: ext.replace('.', ''),
        originalName: file.originalname,
        storageKey: key,
        sizeBytes: file.size,
        floor: meta.floor ?? null,
        label: meta.label ?? null,
        orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      projectId,
      actorId: user.id,
      action: 'document.upload',
      entityType: 'ProjectDocument',
      entityId: document.id,
      payload: { kind: meta.kind, name: file.originalname },
    });

    // Parsing happens eagerly but must never fail the upload response: the
    // document card shows a `failed` badge and the user can retry.
    void this.processing.process(document.id).catch((err) => {
      this.logger.warn(`Analyse différée du document ${document.id} : ${String(err)}`);
    });

    return document;
  }

  async update(
    documentId: string,
    organizationId: string,
    patch: { floor?: string | null; label?: string | null; orderIndex?: number },
  ) {
    const document = await this.findOwned(documentId, organizationId);
    return this.prisma.projectDocument.update({
      where: { id: document.id },
      data: {
        floor: patch.floor ?? document.floor,
        label: patch.label ?? document.label,
        orderIndex: patch.orderIndex ?? document.orderIndex,
      },
    });
  }

  async remove(documentId: string, user: AuthUser) {
    const document = await this.findOwned(documentId, user.organizationId);
    await this.storage.remove(document.storageKey);
    await this.prisma.projectDocument.delete({ where: { id: document.id } });
    await this.audit.record({
      organizationId: user.organizationId,
      projectId: document.projectId,
      actorId: user.id,
      action: 'document.delete',
      entityType: 'ProjectDocument',
      entityId: document.id,
    });
    return { ok: true };
  }

  async reparse(documentId: string, organizationId: string) {
    const document = await this.findOwned(documentId, organizationId);
    return this.processing.process(document.id);
  }

  async raw(documentId: string, organizationId: string) {
    const document = await this.findOwned(documentId, organizationId);
    return { document, stream: this.storage.stream(document.storageKey) };
  }

  /** Documents of a project, in the shape the AI Gateway expects as grounding. */
  async contextFor(projectId: string, kinds?: DocumentKind[]) {
    const documents = await this.prisma.projectDocument.findMany({
      where: { projectId, ...(kinds ? { kind: { in: kinds } } : {}) },
      orderBy: [{ orderIndex: 'asc' }],
    });
    return documents;
  }

  private async findOwned(documentId: string, organizationId: string) {
    const document = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, project: { organizationId } },
    });
    if (!document) throw new NotFoundException('Document introuvable.');
    return document;
  }

  private async assertProject(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projet introuvable.');
    return project;
  }
}
