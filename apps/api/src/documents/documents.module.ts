import { Global, Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentProcessingService } from './document-processing.service';
import { OcrAdapter } from './parsers/ocr.adapter';

@Global()
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentProcessingService, OcrAdapter],
  exports: [DocumentsService, DocumentProcessingService],
})
export class DocumentsModule {}
