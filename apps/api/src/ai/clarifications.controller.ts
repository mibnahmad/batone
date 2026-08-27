import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { answerClarificationSchema, ClarificationStatus, ServiceId } from '@batione/shared';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ClarificationService } from './clarification.service';
import { PrismaService } from '../common/prisma.service';


@Controller()
export class ClarificationsController {
  constructor(
    private readonly clarifications: ClarificationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects/:projectId/clarifications')
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Query('service') service?: string,
    @Query('status') status?: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projet introuvable.');

    return this.clarifications.list(
      projectId,
      service as ServiceId | undefined,
      status as ClarificationStatus | undefined,
    );
  }

  @Post('clarifications/:clarificationId/answer')
  answer(
    @Param('clarificationId') clarificationId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = answerClarificationSchema.parse(body);
    return this.clarifications.answer(clarificationId, user, dto.answer);
  }

  @Post('clarifications/:clarificationId/dismiss')
  dismiss(
    @Param('clarificationId') clarificationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clarifications.dismiss(clarificationId, user);
  }
}

