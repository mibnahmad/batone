import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  app.enableShutdownHooks();

  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API BatiOne démarrée sur http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
