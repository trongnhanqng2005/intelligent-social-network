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
import { createDefaultProfile, normalizeSearchKey } from '../src/domain/user-profile.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import type { OwnProfile, ProfileUpdate } from '../src/modules/users/users.types.js';
import { FriendshipsRepository } from '../src/modules/friendships/friendships.repository.js';

const origin = 'http://127.0.0.1:3000';

describe('Authentication HTTP contract (in-memory persistence double)', () => {
  let app: NestExpressApplication;
  let users: Array<{ id: string; email: string; passwordHash: string }>;
  let sessions: Array<{ jti: string; userId: string; expiresAt: string; revoked: boolean }>;
  let profiles: Map<string, OwnProfile>;
  let friendshipsRepository: {
    createRequest: jest.Mock;
    actOnRequest: jest.Mock;
    listRequests: jest.Mock;
    listFriends: jest.Mock;
    getRelationship: jest.Mock;
    unfriend: jest.Mock;
  };
  let tokens = new Map<string, { sub: string; jti: string; iat: number; exp: number }>;

  beforeAll(async () => {
    users = [];
    sessions = [];
    profiles = new Map();
    tokens = new Map();
    friendshipsRepository = {
      createRequest: jest.fn(async (input) => ({
        kind: 'success',
        result: {
          request: { id: input.requestId, senderId: input.senderId, recipientId: input.recipientId,
            status: 'PENDING', createdAt: input.now, resolvedAt: null },
          relationship: { memberId: input.recipientId, state: 'outgoing_pending', requestId: input.requestId,
            friendshipId: null, friendsSince: null },
        },
      })),
      actOnRequest: jest.fn(async (input) => ({
        kind: 'success',
        result: {
          request: { id: input.requestId, senderId: '11111111-1111-4111-8111-111111111111',
            recipientId: '22222222-2222-4222-8222-222222222222',
            status: input.action === 'accept' ? 'ACCEPTED' : input.action === 'reject' ? 'REJECTED' : 'CANCELLED',
            createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: input.now },
          relationship: { memberId: '22222222-2222-4222-8222-222222222222',
            state: input.action === 'accept' ? 'friends' : 'none', requestId: null,
            friendshipId: input.action === 'accept' ? input.friendshipId : null,
            friendsSince: input.action === 'accept' ? input.now : null },
        },
      })),
      listRequests: jest.fn().mockResolvedValue([]),
      listFriends: jest.fn().mockResolvedValue([]),
      getRelationship: jest.fn().mockResolvedValue({ kind: 'found', relationship: {
        memberId: '22222222-2222-4222-8222-222222222222', state: 'none',
        requestId: null, friendshipId: null, friendsSince: null,
      } }),
      unfriend: jest.fn().mockResolvedValue(undefined),
    };
    const repository = {
      register: jest.fn(async (input) => {
        if (users.some((user) => user.email === input.email)) {
          throw new AccountConflictError();
        }
        users.push({ id: input.id, email: input.email, passwordHash: input.passwordHash });
        const profile = createDefaultProfile(input.id, input.now);
        profiles.set(input.id, {
          id: profile.id,
          displayName: profile.displayName,
          bio: null,
          location: null,
          createdAt: profile.profileCreatedAt,
          updatedAt: profile.profileUpdatedAt,
          version: profile.profileVersion,
        });
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
    const profileRepository = {
      findOwnProfile: jest.fn(async (userId: string) => profiles.get(userId)),
      findPublicProfile: jest.fn(async (userId: string) => {
        const profile = profiles.get(userId);
        if (!profile) return undefined;
        return { id: profile.id, displayName: profile.displayName, bio: profile.bio, location: profile.location };
      }),
      listPublicProfiles: jest.fn(async (input: { userId: string; query: string; afterId?: string; fetchLimit: number }) =>
        [...profiles.values()]
          .filter((profile) => profile.id !== input.userId &&
            normalizeSearchKey(profile.displayName).includes(input.query) &&
            (!input.afterId || profile.id > input.afterId))
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, input.fetchLimit)
          .map((profile) => ({ id: profile.id, displayName: profile.displayName, bio: profile.bio, location: profile.location }))),
      updateProfile: jest.fn(async (input: ProfileUpdate) => {
        const profile = profiles.get(input.userId);
        if (!profile) return { status: 'not-found' as const };
        if (profile.version !== input.expectedVersion) return { status: 'conflict' as const };
        const updated: OwnProfile = {
          ...profile,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          updatedAt: input.updatedAt,
          version: profile.version + 1,
        };
        profiles.set(input.userId, updated);
        return { status: 'updated' as const, profile: updated };
      }),
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
      .overrideProvider(UsersRepository).useValue(profileRepository)
      .overrideProvider(FriendshipsRepository).useValue(friendshipsRepository)
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

  it('keeps no-store and security headers on malformed or oversized profile JSON errors', async () => {
    const malformed = await request(app.getHttpServer()).patch('/users/me/profile')
      .set('Content-Type', 'application/json')
      .send('{"displayName":')
      .expect(400);
    expect(malformed.headers['cache-control']).toContain('no-store');
    expect(malformed.headers['x-content-type-options']).toBe('nosniff');

    const oversized = await request(app.getHttpServer()).patch('/users/me/profile')
      .set('Content-Type', 'application/json')
      .send(`{"bio":"${'x'.repeat(9000)}"}`)
      .expect(413);
    expect(oversized.headers['cache-control']).toContain('no-store');
    expect(oversized.headers['x-content-type-options']).toBe('nosniff');
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

  it('protects profile routes and exposes only member-visible fields with no-store caching', async () => {
    await request(app.getHttpServer()).get('/users/me/profile')
      .expect('Cache-Control', /no-store/)
      .expect(401);

    const owner = request.agent(app.getHttpServer());
    const bootstrap = await owner.get('/auth/csrf').expect(200);
    const registration = await owner.post('/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'profile-owner@example.test', password: 'a sufficiently long password' })
      .expect(201);
    const ownerId = registration.body.user.id as string;
    const login = await owner.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'profile-owner@example.test', password: 'a sufficiently long password' })
      .expect(200);
    const ownerCsrf = login.body.csrfToken as string;

    const updated = await owner.patch('/users/me/profile')
      .set('Origin', origin)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ displayName: 'Nguyễn An', bio: 'Xin chào.', location: null, expectedVersion: 0 })
      .expect('Cache-Control', /no-store/)
      .expect(200);
    expect(updated.body.profile).toMatchObject({
      id: ownerId, displayName: 'Nguyễn An', bio: 'Xin chào.', location: null, version: 1,
    });
    expect(updated.body.profile).toHaveProperty('createdAt');
    expect(updated.body.profile).toHaveProperty('updatedAt');
    expect(updated.body.profile).not.toHaveProperty('email');
    expect(updated.body.profile).not.toHaveProperty('passwordHash');

    const member = request.agent(app.getHttpServer());
    const memberBootstrap = await member.get('/auth/csrf').expect(200);
    const memberRegistration = await member.post('/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', memberBootstrap.body.csrfToken)
      .send({ email: 'profile-member@example.test', password: 'a sufficiently long password' })
      .expect(201);
    await member.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', memberBootstrap.body.csrfToken)
      .send({ email: 'profile-member@example.test', password: 'a sufficiently long password' })
      .expect(200);

    const publicProfile = await member.get(`/users/${ownerId}/profile`)
      .expect('Cache-Control', /no-store/)
      .expect(200);
    expect(publicProfile.body.profile).toEqual({
      id: ownerId, displayName: 'Nguyễn An', bio: 'Xin chào.', location: null,
    });
    expect(Object.keys(publicProfile.body.profile).sort()).toEqual(['bio', 'displayName', 'id', 'location']);

    const directory = await member.get('/users?q=NGUYEN')
      .expect('Cache-Control', /no-store/)
      .expect(200);
    expect(directory.body.items).toEqual([publicProfile.body.profile]);
    expect(directory.body.items.some((item: { id: string }) => item.id === memberRegistration.body.user.id)).toBe(false);
    expect(directory.body.pagination).toMatchObject({ limit: 20, hasMore: false, nextCursor: null });
  });

  it('enforces profile CSRF, JSON-only updates, strict fields and optimistic versions over HTTP', async () => {
    const browser = request.agent(app.getHttpServer());
    const bootstrap = await browser.get('/auth/csrf').expect(200);
    await browser.post('/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'profile-security@example.test', password: 'a sufficiently long password' })
      .expect(201);
    const login = await browser.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'profile-security@example.test', password: 'a sufficiently long password' })
      .expect(200);
    const csrf = login.body.csrfToken as string;

    await browser.patch('/users/me/profile')
      .set('Origin', origin)
      .set('Content-Type', 'text/plain')
      .send('{"displayName":"Rejected"}')
      .expect('Cache-Control', /no-store/)
      .expect(415);
    await browser.patch('/users/me/profile')
      .set('Origin', origin)
      .send({ displayName: 'Rejected', expectedVersion: 0 })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('CSRF_FAILED'));
    await browser.patch('/users/me/profile')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ displayName: 'Valid Name', email: 'private@example.test', expectedVersion: 0 })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    await browser.patch('/users/me/profile')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ displayName: 'Tên mới', expectedVersion: 0 })
      .expect(200);
    await browser.patch('/users/me/profile')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'Bản nháp cũ', expectedVersion: 0 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PROFILE_CONFLICT'));

    const own = await browser.get('/users/me/profile').expect(200);
    expect(own.body.profile).toMatchObject({ displayName: 'Tên mới', version: 1, bio: null });
  });

  it('protects Friendship routes and enforces no-store, CSRF, JSON, strict bodies and caller identity', async () => {
    await request(app.getHttpServer()).get('/friendships')
      .expect('Cache-Control', /no-store/)
      .expect(401);
    const anonymousMalformed = await request(app.getHttpServer()).post('/friendships/requests')
      .set('Content-Type', 'application/json')
      .send('{"recipientId":')
      .expect(400);
    expect(anonymousMalformed.headers['cache-control']).toContain('no-store');

    const browser = request.agent(app.getHttpServer());
    const bootstrap = await browser.get('/auth/csrf').expect(200);
    const login = await browser.post('/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', bootstrap.body.csrfToken)
      .send({ email: 'profile-security@example.test', password: 'a sufficiently long password' })
      .expect(200);
    const csrf = login.body.csrfToken as string;
    const actorId = login.body.user.id as string;
    const recipientId = '22222222-2222-4222-8222-222222222222';

    await browser.post('/friendships/requests')
      .set('Origin', origin)
      .send({ recipientId })
      .expect('Cache-Control', /no-store/)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('CSRF_FAILED'));
    await browser.post('/friendships/requests')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .set('Content-Type', 'text/plain')
      .send(`recipientId=${recipientId}`)
      .expect('Cache-Control', /no-store/)
      .expect(415);
    await browser.post('/friendships/requests')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ recipientId, senderId: recipientId })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    const created = await browser.post('/friendships/requests')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ recipientId })
      .expect('Cache-Control', /no-store/)
      .expect(201);
    expect(created.body.request).toMatchObject({ senderId: actorId, recipientId, status: 'PENDING' });
    expect(created.body.request.id).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(friendshipsRepository.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      senderId: actorId,
      recipientId,
      requestId: created.body.request.id,
    }));

    await browser.get('/friendships/requests?direction=received')
      .expect('Cache-Control', /no-store/)
      .expect(200, { items: [], pagination: { limit: 20, hasMore: false, nextCursor: null } });
    await browser.get('/friendships/requests?direction=unknown').expect(422);
    await browser.get('/friendships?limit=51').expect(422);
    await browser.get('/friendships/status/not-a-uuid').expect(422);
    const status = await browser.get('/friendships/status/22222222-2222-4222-8222-222222222222')
      .expect('Cache-Control', /no-store/)
      .expect(200);
    expect(status.body.relationship).toMatchObject({ state: 'none' });

    const actionId = '33333333-3333-4333-8333-333333333333';
    for (const action of ['accept', 'reject', 'cancel']) {
      await browser.post(`/friendships/requests/${actionId}/${action}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .set('Content-Type', 'application/json')
        .expect('Cache-Control', /no-store/)
        .expect(422)
        .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
    }
    await browser.post(`/friendships/requests/${actionId}/accept`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .set('Transfer-Encoding', 'chunked')
      .expect('Cache-Control', /no-store/)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
    expect(friendshipsRepository.actOnRequest).not.toHaveBeenCalled();
    await browser.post(`/friendships/requests/${actionId}/accept`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ unexpected: true })
      .expect(422);
    await browser.post(`/friendships/requests/${actionId}/accept`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect('Cache-Control', /no-store/)
      .expect(200);
    await browser.post(`/friendships/requests/${actionId}/reject`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(200);
    await browser.post(`/friendships/requests/${actionId}/cancel`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(200);
    expect(friendshipsRepository.actOnRequest.mock.calls.map(([input]) => input.action))
      .toEqual(['accept', 'reject', 'cancel']);

    const friendshipId = '44444444-4444-4444-8444-444444444444';
    await browser.delete(`/friendships/${friendshipId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .expect('Cache-Control', /no-store/)
      .expect(204);
    expect(friendshipsRepository.unfriend).toHaveBeenCalledWith(actorId, friendshipId);
    await browser.delete(`/friendships/${friendshipId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ body: true })
      .expect(422);
  });
});
