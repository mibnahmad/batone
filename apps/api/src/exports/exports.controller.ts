import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ExportFormat, ServiceId } from '@batione/shared';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ExportService } from './export.service';

const createSchema = z.object({
  service: z.nativeEnum(ServiceId),
  format: z.nativeEnum(ExportFormat),
});

@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportService) {}

  @Get('projects/:projectId/exports')
  list(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.exports.list(projectId, user.organizationId);
  }

  @Post(['projects/:projectId/exports', 'projects/:projectId/export'])
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = createSchema.parse(body);
    return this.exports.create(projectId, user, dto.service, dto.format);
  }

  @Get('exports/:exportId/download')
  async download(
    @Param('exportId') exportId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { artifact, stream, contentType } = await this.exports.download(
      exportId,
      user.organizationId,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(artifact.filename)}"`,
    );
    stream.pipe(res);
  }
}
