import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = Number(configService.getOrThrow<string>('PORT'));
  const host = configService.getOrThrow<string>('HOST');

  await app.listen(port, host);
}

void bootstrap();
