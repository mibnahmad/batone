import { Global, Module } from '@nestjs/common';
import { PriceCalculator } from './price-calculator';
import { RebarCalculator } from './rebar-calculator';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Global()
@Module({
  controllers: [RulesController],
  providers: [RulesService, RebarCalculator, PriceCalculator],
  exports: [RulesService, RebarCalculator, PriceCalculator],
})
export class RulesModule {}
