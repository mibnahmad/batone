import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { correctionSchema } from '@batione/shared';
import { AuthUser, CurrentUser } from '../../auth/auth.decorators';
import { TakeoffService } from './takeoff.service';

@Controller()
export class TakeoffController {
  constructor(private readonly takeoff: TakeoffService) {}

  @Get('projects/:projectId/takeoff')
  read(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.takeoff.read(projectId, user.organizationId);
  }

  @Patch('takeoff/:lineId')
  correct(
    @Param('lineId') lineId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.takeoff.correct(lineId, user, correctionSchema.parse(body));
  }
}
