import { Module } from '@nestjs/common';
import { RebarController } from './rebar.controller';
import { RebarService } from './rebar.service';

@Module({
  controllers: [RebarController],
  providers: [RebarService],
  exports: [RebarService],
})
export class RebarModule {}
