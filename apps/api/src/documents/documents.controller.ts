import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { DocumentKind, uploadDocumentMetaSchema } from '@batione/shared';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { DocumentsService } from './documents.service';

const patchSchema = z.object({
  floor: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  orderIndex: z.coerce.number().int().optional(),
});

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('projects/:projectId/documents')
  list(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.documents.list(projectId, user.organizationId);
  }

  @Post('projects/:projectId/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }),
  )
  upload(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, string>,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    const meta = uploadDocumentMetaSchema.safeParse({
      kind: body.kind ?? DocumentKind.PLAN,
      floor: body.floor || undefined,
      label: body.label || undefined,
    });
    if (!meta.success) {
      throw new BadRequestException('Métadonnées de document invalides.');
    }
    return this.documents.upload(projectId, user, file, meta.data);
  }

  @Patch('documents/:documentId')
  update(
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const patch = patchSchema.parse(body);
    return this.documents.update(documentId, user.organizationId, patch);
  }

  @Post('documents/:documentId/reparse')
  reparse(@Param('documentId') documentId: string, @CurrentUser() user: AuthUser) {
    return this.documents.reparse(documentId, user.organizationId);
  }

  @Delete('documents/:documentId')
  remove(@Param('documentId') documentId: string, @CurrentUser() user: AuthUser) {
    return this.documents.remove(documentId, user);
  }

  @Get('documents/:documentId/raw')
  async raw(
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { document, stream } = await this.documents.raw(
      documentId,
      user.organizationId,
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(document.originalName)}"`,
    );
    stream.pipe(res);
  }
}
