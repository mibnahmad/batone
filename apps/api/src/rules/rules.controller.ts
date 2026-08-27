import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.decorators';
import { RulesService, RuleDomain } from './rules.service';

@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('domain') domain?: string) {
    return this.rules.listForOrganization(user.organizationId, domain as RuleDomain | undefined);
  }
}
