import 'reflect-metadata';
import { ForbiddenException, ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthSecurityService } from '../auth/auth-security.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthSessionGuard } from '../auth/auth-session.guard.js';
import { MlDemoController } from './ml-demo.controller.js';
import { MlDemoService } from './ml-demo.service.js';
import { noStore } from './ml-demo.module.js';

describe('ML demo authenticated endpoints', () => {
  let app: INestApplication;
  const reviewerId = '11111111-1111-4111-8111-111111111111';
  const deniedId = '22222222-2222-4222-8222-222222222222';
  const auth = {
    restoreSession: jest.fn(async (token: string) => token === 'reviewer' || token === 'denied'
      ? { user: { id: token === 'reviewer' ? reviewerId : deniedId, email: 'demo@example.test' }, jti: 'jti', expiresAt: new Date(Date.now() + 60000).toISOString() }
      : null),
  };
  const security = { sessionCookieName: 'isn_session', clearSessionAndRotate: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MlDemoController],
      providers: [
        AuthSessionGuard,
        { provide: AuthService, useValue: auth },
        { provide: AuthSecurityService, useValue: security },
        { provide: MlDemoService, useValue: {
          recommendations: jest.fn(async (user: { id: string }) => ({ source: 'synthetic', canViewAlerts: user.id === reviewerId, modelVersion: 'test-v1', computedAt: '2026-01-01T00:00:00Z', items: [] })),
          anomalies: jest.fn(async (user: { id: string }) => user.id === reviewerId
            ? { source: 'synthetic', modelVersion: 'anomaly-v1', threshold: 0.1, evaluatedCount: 0, alerts: [] }
            : Promise.reject(new ForbiddenException())),
        } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use(noStore);
    await app.init();
  });
  afterAll(async () => app.close());

  it('requires a valid session on direct endpoint requests', async () => {
    const anonymous = await request(app.getHttpServer()).get('/ml-demo/recommendations').expect(401);
    expect(anonymous.headers['cache-control']).toContain('no-store');
    const invalid = await request(app.getHttpServer()).get('/ml-demo/anomalies').set('Cookie', 'isn_session=garbage').expect(401);
    expect(invalid.headers['cache-control']).toContain('no-store');
  });

  it('returns recommendations to a member but denies direct anomaly access to non-reviewers', async () => {
    const rec = await request(app.getHttpServer()).get('/ml-demo/recommendations').set('Cookie', 'isn_session=denied').expect(200);
    expect(rec.headers['cache-control']).toContain('no-store');
    expect(rec.body.canViewAlerts).toBe(false);
    const denied = await request(app.getHttpServer()).get('/ml-demo/anomalies').set('Cookie', 'isn_session=denied').expect(403);
    expect(denied.headers['cache-control']).toContain('no-store');
  });

  it('allows a reviewer through the same session guard to the protected endpoint', async () => {
    const response = await request(app.getHttpServer()).get('/ml-demo/anomalies').set('Cookie', 'isn_session=reviewer').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.source).toBe('synthetic');
  });

  it('keeps service-unavailable responses uncacheable', async () => {
    jest.spyOn(app.get(MlDemoService), 'recommendations').mockRejectedValueOnce(new ServiceUnavailableException());
    const response = await request(app.getHttpServer()).get('/ml-demo/recommendations').set('Cookie', 'isn_session=reviewer').expect(503);
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
