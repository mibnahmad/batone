import { Module } from '@nestjs/common';
import { TakeoffController } from './takeoff.controller';
import { TakeoffService } from './takeoff.service';

@Module({
  controllers: [TakeoffController],
  providers: [TakeoffService],
  exports: [TakeoffService],
})
export class TakeoffModule {}
