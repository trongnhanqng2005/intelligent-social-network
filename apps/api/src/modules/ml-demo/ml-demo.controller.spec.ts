import 'reflect-metadata';
import { ServiceUnavailableException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthSecurityService } from '../auth/auth-security.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthSessionGuard } from '../auth/auth-session.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { MlDemoController } from './ml-demo.controller.js';
import { MlDemoService } from './ml-demo.service.js';
import { noStore } from './ml-demo.module.js';

describe('ML demo authenticated endpoints', () => {
  let app: INestApplication;
  const adminId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';
  const auth = {
    restoreSession: jest.fn(async (token: string) => token === 'admin' || token === 'member'
      ? { user: { id: token === 'admin' ? adminId : memberId, email: `${token}@example.test`, role: token === 'admin' ? 'ADMIN' : 'USER' }, jti: 'jti', expiresAt: new Date(Date.now() + 60000).toISOString() }
      : null),
  };
  const security = { sessionCookieName: 'isn_session', clearSessionAndRotate: jest.fn() };
  const demo = {
    recommendations: jest.fn(async () => ({ source: 'synthetic', canViewAlerts: true, modelVersion: 'test-v1', computedAt: '2026-01-01T00:00:00Z', items: [] })),
    anomalies: jest.fn(async () => ({ source: 'synthetic', snapshotId: 'a'.repeat(64), modelVersion: 'anomaly-v1', threshold: 0.1, evaluatedCount: 1, alerts: [] })),
    review: jest.fn(async (user: { id: string }, snapshotId: string, actorId: string) => ({ snapshotId, actorId, reviewedAt: user.id })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MlDemoController],
      providers: [
        AuthSessionGuard, AdminGuard,
        { provide: AuthService, useValue: auth },
        { provide: AuthSecurityService, useValue: security },
        { provide: MlDemoService, useValue: demo },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use(noStore);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(async () => app.close());

  it('uses the actual session and admin guards for HTTP 401/403/200', async () => {
    await request(app.getHttpServer()).get('/ml-demo/anomalies').expect(401);
    await request(app.getHttpServer()).get('/ml-demo/anomalies').set('Cookie', 'isn_session=member').expect(403);
    const response = await request(app.getHttpServer()).get('/ml-demo/anomalies').set('Cookie', 'isn_session=admin').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.source).toBe('synthetic');
  });

  it('validates the review DTO and passes the authenticated principal to the write', async () => {
    await request(app.getHttpServer()).put('/ml-demo/anomalies/review').set('Cookie', 'isn_session=admin')
      .send({ snapshotId: 'bad', actorId: 'bad' }).expect(400);
    const snapshotId = 'a'.repeat(64);
    const response = await request(app.getHttpServer()).put('/ml-demo/anomalies/review').set('Cookie', 'isn_session=admin')
      .send({ snapshotId, actorId: 'synthetic-test-actor-001' }).expect(200);
    expect(response.body).toEqual({ snapshotId, actorId: 'synthetic-test-actor-001', reviewedAt: adminId });
    expect(demo.review).toHaveBeenCalledWith(expect.objectContaining({ id: adminId, role: 'ADMIN' }), snapshotId, 'synthetic-test-actor-001');
  });

  it('keeps service-unavailable responses uncacheable', async () => {
    demo.recommendations.mockRejectedValueOnce(new ServiceUnavailableException());
    const response = await request(app.getHttpServer()).get('/ml-demo/recommendations').set('Cookie', 'isn_session=admin').expect(503);
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
