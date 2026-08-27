import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { EntitlementsService } from './entitlements.service';

@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.entitlements.list(user.organizationId);
  }
}
