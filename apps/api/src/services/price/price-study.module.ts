import { Module } from '@nestjs/common';
import { PriceStudyController } from './price-study.controller';
import { PriceStudyService } from './price-study.service';

@Module({
  controllers: [PriceStudyController],
  providers: [PriceStudyService],
  exports: [PriceStudyService],
})
export class PriceStudyModule {}
