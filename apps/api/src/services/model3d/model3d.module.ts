import { Module } from '@nestjs/common';
import { Model3DController } from './model3d.controller';
import { Model3DService } from './model3d.service';

@Module({
  controllers: [Model3DController],
  providers: [Model3DService],
  exports: [Model3DService],
})
export class Model3DModule {}
