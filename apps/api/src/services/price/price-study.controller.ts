import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { priceItemInputSchema } from '@batione/shared';
import { AuthUser, CurrentUser } from '../../auth/auth.decorators';
import { PriceStudyService } from './price-study.service';

interface CorrectionInput {
  field: string;
  value: unknown;
  reason?: string;
}

const patchItemSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  reason: z.string().max(2000).optional(),
});

const patchStudySchema = z.object({
  ruleSetId: z.string().nullable().optional(),
  name: z.string().optional(),
  currency: z.string().optional(),
});

@Controller()
export class PriceStudyController {
  constructor(private readonly priceStudy: PriceStudyService) {}

  @Get('projects/:projectId/price-study')
  read(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.priceStudy.read(projectId, user.organizationId);
  }

  @Post('projects/:projectId/price-study/items')
  addItem(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.priceStudy.addItem(projectId, user, priceItemInputSchema.parse(body));
  }

  @Patch('price-items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.priceStudy.updateItem(itemId, user, patchItemSchema.parse(body) as CorrectionInput);
  }

  @Delete('price-items/:itemId')
  removeItem(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    return this.priceStudy.removeItem(itemId, user);
  }

  @Patch('projects/:projectId/price-study')
  updateStudy(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.priceStudy.updateStudy(projectId, user, patchStudySchema.parse(body));
  }

  @Post('projects/:projectId/price-study/import-takeoff')
  importTakeoff(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.priceStudy.importTakeoff(projectId, user);
  }
}
