import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureAuthHttp } from '../src/modules/auth/auth-http.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { AccountConflictError } from '../src/modules/auth/auth.repository.js';
import { AuthSecurityService } from '../src/modules/auth/auth-security.service.js';
import { JwtService } from '../src/modules/auth/jwt.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';

const origin = 'http://127.0.0.1:3000';

describe('Authentication HTTP contract (in-memory persistence double)', () => {
  let app: NestExpressApplication;
  let users: Array<{ id: string; email: string; passwordHash: string }>;
  let sessions: Array<{ jti: string; userId: string; expiresAt: string; revoked: boolean }>;
  let tokens = new Map<string, { sub: string; jti: string; iat: number; exp: number }>;

  beforeAll(async () => {
    users = [];
    sessions = [];
    tokens = new Map();
    const repository = {
      register: jest.fn(async (input) => {
        if (users.some((user) => user.email === input.email)) {
          throw new AccountConflictError();
        }
        users.push({ id: input.id, email: input.email, passwordHash: input.passwordHash });
        return { id: input.id, email: input.email };
      }),
      findCredentials: jest.fn(async (email) => users.find((user) => user.email === email)),
      createSession: jest.fn(async (input) => {
        const user = users.find((entry) => entry.id === input.user.id && entry.passwordHash === input.expectedPasswordHash);
        if (!user) return false;
        sessions.push({ jti: input.jti, userId: user.id, expiresAt: input.expiresAt, revoked: false });
        return true;
      }),
      findActiveSession: jest.fn(async (userId, jti) => {
        const session = sessions.find((entry) => entry.userId === userId && entry.jti === jti && !entry.revoked && Date.parse(entry.expiresAt) > Date.now());
        const user = users.find((entry) => entry.id === userId);
        return session && user ? { id: user.id, email: user.email, expiresAt: session.expiresAt } : undefined;
      }),
      revokeSession: jest.fn(async (input) => {
        const session = sessions.find((entry) => entry.userId === input.userId && entry.jti === input.jti && !entry.revoked);
        if (!session) return false;
        session.revoked = true;
        return true;
      }),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
    };
    const passwords = {
      hash: jest.fn(async (password: string) => `hash:${password}`),
      verify: jest.fn(async (hash: string, password: string) => hash === `hash:${password}`),
      needsRehash: jest.fn().mockReturnValue(false),
      dummyVerify: jest.fn().mockResolvedValue(undefined),
    };
    const jwt = {
      signSession: jest.fn(async (sub: string, jti: string, iat: number) => {
        const token = `fake.${jti}`;
        tokens.set(token, { sub, jti, iat, exp: iat + 86_400 });
        return token;
      }),
      verifySessionToken: jest.fn(async (token: string) => {
        const claims = tokens.get(token);
        if (!claims || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('invalid token');
        return claims;
      }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthRepository).useValue(repository)
      .overrideProvider(PasswordService).useValue(passwords)
      .overrideProvider(JwtService).useValue(jwt)
      .compile();
    const security = moduleRef.get(AuthSecurityService);
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureAuthHttp(app, security, origin);
    await app.init();
  });

  afterAll(async () => app.close());

  it('preserves health and requires matching Origin and signed CSRF on unsafe requests', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer()).post('/auth/register')
      .set('Origin', 'https://attacker.example.test')
      .send({ email: 'alice@example.test', password: 'long enough password' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('CSRF_FAILED'));
    await request(app.getHttpServer()).post('/auth/register')
      .set('Origin', origin)
      .send({ email: 'no-token@example.test', password: 'a sufficiently long password' })
      .expect(403);
  });

  it('returns a bounded safe error for JSON bodies larger than 8 KiB', async () => {
    await request(app.getHttpServer()).post('/auth/register')
      .set('Content-Type', 'application/json')
      .send({ email: 'large@example.test', password: 'x'.repeat(9000) })
      .expect(413)
      .expect(({ body }) => expect(body.error.code).toBe('PAYLOAD_TOO_LARGE'));
  });

  it('registers, logs in, restores after reload, and revokes on logout', async () => {
    const browser = request.agent(app.getHttpServer());
    const bootstrap = await browser.get('/auth/csrf').expect(200);
    expect(bootstrap.headers['cache-control']).toContain('no-store');
    const csrf = bootstrap.body.csrfToken as string;
    await browser.post('/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'Alice@Example.test', password: 'a sufficiently long password' })
      .expect(201)
      .expect(({ body }) => expect(body.user).toMatchObject({ email: 'alice@example.test' }));

    await browser.post('/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@example.test', password: 'a sufficiently long password' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe('REGISTRATION_CONFLICT');
        expect(JSON.stringify(body)).not.toContain('alice@example.test');
      });

    const login = await browser.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'alice@example.test', password: 'a sufficiently long password' })
      .expect(200);
    expect(login.body).not.toHaveProperty('token');
    expect(login.body.session.expiresAt).toBeTruthy();
    expect(login.body.csrfToken).not.toBe(csrf);
    const setCookie = String(login.headers['set-cookie'] ?? '');
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=86400/);

    await browser.post('/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .expect(403);

    const restoredCsrf = await browser.get('/auth/csrf').expect(200);

    const session = await browser.get('/auth/session').expect(200);
    expect(session.body.user.email).toBe('alice@example.test');

    await browser.post('/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', restoredCsrf.body.csrfToken)
      .expect(204);
    await browser.get('/auth/session').expect(401);
    const anonymousCsrf = await browser.get('/auth/csrf').expect(200);
    await browser.post('/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', anonymousCsrf.body.csrfToken)
      .expect(204);
  });

  it('allows idempotent anonymous/invalid-cookie logout but still requires Origin and matching CSRF', async () => {
    const browser = request.agent(app.getHttpServer());
    const bootstrap = await browser.get('/auth/csrf').expect(200);
    await browser.post('/auth/logout').set('Origin', origin).expect(403);
    await browser.post('/auth/logout').set('X-CSRF-Token', bootstrap.body.csrfToken).expect(403);
    await browser.post('/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .expect(204);

    const invalidCookie = 'isn_session=invalid-session-token';
    const invalidBootstrap = await request(app.getHttpServer()).get('/auth/csrf')
      .set('Cookie', invalidCookie).expect(200);
    const setCookies: unknown = invalidBootstrap.headers['set-cookie'];
    if (!Array.isArray(setCookies)) throw new Error('Expected CSRF cookies from bootstrap');
    const cookies = [invalidCookie, ...setCookies.map((cookie: string) => cookie.split(';')[0]!)];
    await request(app.getHttpServer()).post('/auth/logout')
      .set('Cookie', cookies)
      .set('Origin', origin)
      .set('X-CSRF-Token', invalidBootstrap.body.csrfToken)
      .expect(204);
  });

  it('returns the same generic login error for an unknown identity and invalidates revoked sessions', async () => {
    const browser = request.agent(app.getHttpServer());
    const bootstrap = await browser.get('/auth/csrf').expect(200);
    const invalid = await browser.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'missing@example.test', password: 'a sufficiently long password' })
      .expect(401);
    expect(invalid.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
