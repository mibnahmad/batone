import { Global, Module } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Global()
@Module({
  controllers: [JobsController],
  providers: [JobQueueService, JobsService],
  exports: [JobQueueService, JobsService],
})
export class JobsModule {}
