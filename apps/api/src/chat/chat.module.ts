import { Module } from '@nestjs/common';
import { Model3DModule } from '../services/model3d/model3d.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [Model3DModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
