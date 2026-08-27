import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../auth/auth.decorators';
import { Model3DService } from './model3d.service';

interface CorrectionInput {
  field: string;
  value: unknown;
  reason?: string;
}

const patchSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  reason: z.string().max(2000).optional(),
});

@Controller()
export class Model3DController {
  constructor(private readonly model3d: Model3DService) {}

  @Get('projects/:projectId/model3d')
  read(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.model3d.read(projectId, user.organizationId);
  }

  @Patch('model3d/elements/:elementId')
  patch(
    @Param('elementId') elementId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.model3d.patchElement(elementId, user, patchSchema.parse(body) as CorrectionInput);
  }

  @Post('projects/:projectId/model3d/undo')
  undo(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.model3d.undo(projectId, user);
  }

  @Post('projects/:projectId/model3d/redo')
  redo(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.model3d.redo(projectId, user);
  }
}
