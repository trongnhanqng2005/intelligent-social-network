import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureAuthHttp } from './modules/auth/auth-http.js';
import { AuthSecurityService } from './modules/auth/auth-security.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  configureAuthHttp(
    app,
    app.get(AuthSecurityService),
    configService.getOrThrow<string>('AUTH_WEB_ORIGIN'),
  );
  const port = Number(configService.getOrThrow<string>('PORT'));
  const host = configService.getOrThrow<string>('HOST');

  await app.listen(port, host);
}

void bootstrap();
