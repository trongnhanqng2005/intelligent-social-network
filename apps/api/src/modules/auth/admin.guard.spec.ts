import { Controller, Get, MiddlewareConsumer, Module, NestModule, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { AuthenticatedRequest } from './auth-session.guard.js';
import { AdminGuard } from './admin.guard.js';

@Controller()
class GuardTestController {
  @Get()
  @UseGuards(AdminGuard)
  admin() {
    return { ok: true };
  }
}

@Module({ controllers: [GuardTestController], providers: [AdminGuard] })
class GuardTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((req: AuthenticatedRequest, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (role === 'USER' || role === 'ADMIN') {
        req.authPrincipal = { id: 'user-1', email: 'user@example.test', role, jti: 'jti', expiresAt: '' };
      }
      next();
    }).forRoutes(GuardTestController);
  }
}

describe('AdminGuard HTTP behavior', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GuardTestModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns 401 for unauthenticated and 403 for authenticated non-admin requests', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
    await request(app.getHttpServer()).get('/').set('x-test-role', 'USER').expect(403);
    await request(app.getHttpServer()).get('/').set('x-test-role', 'ADMIN').expect(200, { ok: true });
  });
});
