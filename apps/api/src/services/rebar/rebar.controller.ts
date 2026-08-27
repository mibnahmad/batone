import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../auth/auth.decorators';
import { RebarService } from './rebar.service';

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
export class RebarController {
  constructor(private readonly rebar: RebarService) {}

  @Get('projects/:projectId/rebar')
  read(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.rebar.read(projectId, user.organizationId);
  }

  @Patch('rebar/elements/:elementId')
  correct(
    @Param('elementId') elementId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.rebar.correctElement(elementId, user, patchSchema.parse(body) as CorrectionInput);
  }

  @Post('projects/:projectId/rebar/recompute')
  recompute(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.rebar.recompute(projectId, user);
  }
}
