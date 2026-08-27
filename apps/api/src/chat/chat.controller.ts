import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ServiceId } from '@batione/shared';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { ChatService } from './chat.service';

const sendSchema = z.object({
  content: z.string().min(1).max(4000),
  selectedIds: z.array(z.string()).optional(),
});

const serviceSchema = z.nativeEnum(ServiceId);

const messageRefSchema = z.object({ messageId: z.string().min(1) });

@Controller('projects/:projectId/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':service')
  history(
    @Param('projectId') projectId: string,
    @Param('service') service: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chat.history(projectId, serviceSchema.parse(service), user.organizationId);
  }

  @Post(':service')
  send(
    @Param('projectId') projectId: string,
    @Param('service') service: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    return this.chat.send(projectId, serviceSchema.parse(service), user, sendSchema.parse(body));
  }

  @Post(':service/apply')
  apply(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.chat.applyProposal(messageRefSchema.parse(body).messageId, user);
  }

  @Post(':service/discard')
  discard(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.chat.discardProposal(messageRefSchema.parse(body).messageId, user);
  }
}
