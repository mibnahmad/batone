import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ChatModule } from './chat/chat.module';
import { CommonModule } from './common/common.module';
import { ZodExceptionFilter } from './common/zod-exception.filter';
import { DocumentsModule } from './documents/documents.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { ExportsModule } from './exports/exports.module';
import { JobsModule } from './jobs/jobs.module';
import { ProjectsModule } from './projects/projects.module';
import { RulesModule } from './rules/rules.module';
import { Model3DModule } from './services/model3d/model3d.module';
import { PriceStudyModule } from './services/price/price-study.module';
import { RebarModule } from './services/rebar/rebar.module';
import { TakeoffModule } from './services/takeoff/takeoff.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    CommonModule,
    AuthModule,
    EntitlementsModule,
    ProjectsModule,
    DocumentsModule,
    RulesModule,
    AiModule,
    JobsModule,
    TakeoffModule,
    Model3DModule,
    RebarModule,
    PriceStudyModule,
    ChatModule,
    ExportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule {}
