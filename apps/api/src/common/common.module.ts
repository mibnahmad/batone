import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { TraceabilityService } from './traceability.service';

@Global()
@Module({
  providers: [PrismaService, StorageService, AuditService, TraceabilityService],
  exports: [PrismaService, StorageService, AuditService, TraceabilityService],
})
export class CommonModule {}
