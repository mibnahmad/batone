import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportsController } from './exports.controller';

@Module({
  controllers: [ExportsController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportsModule {}
