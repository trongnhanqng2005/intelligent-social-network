import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { MlDemoController } from './ml-demo.controller.js';
import { MlDemoService } from './ml-demo.service.js';

@Module({ imports: [AuthModule], controllers: [MlDemoController], providers: [MlDemoService] })
export class MlDemoModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(noStore).forRoutes(
      { path: 'ml-demo/recommendations', method: RequestMethod.GET },
      { path: 'ml-demo/anomalies', method: RequestMethod.GET },
    );
  }
}

export function noStore(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
