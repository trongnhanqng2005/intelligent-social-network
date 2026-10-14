import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import {
  countAsNumber,
  recordFixtureOwnership,
  removeFixtureManifest,
  removeOwnedFixture,
  updateFixtureOwnership,
} from './fixture-ownership.mjs';

test('real isn-test profiles persist safely and simultaneous versioned updates cannot overwrite each other', async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'Set NODE_ENV=test before real profile integration');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test', 'Profile integration never falls back from isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD,
    'Configure NEO4J_URI and dedicated test credentials in apps/api/.env.test.local');
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD,
    'Do not provide development administrator credentials to real integration tests');

  const neo4j = await import('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const fixtureUserIds = [randomUUID(), randomUUID(), randomUUID()];
  const marker = `profile-${randomUUID().slice(0, 8)}`;
  const emails = fixtureUserIds.map((id) => `profile-${id}@example.invalid`);
  const password = 'synthetic profile integration password';
  const fixtureManifests = new Map();
  let baselineCounts;
  let targetVerified = false;
  let app;
  let authKeyDirectory;
  const authEnvironmentKeys = [
    'AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH',
    'AUTH_KEY_ID', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_WEB_ORIGIN',
  ];
  const previousAuthEnvironment = new Map(authEnvironmentKeys.map((key) => [key, process.env[key]]));
  const agents = [];

  try {
    await driver.verifyConnectivity();
    const identity = driver.session({ database: 'isn-test' });
    try {
      const database = await identity.run('CALL db.info() YIELD name RETURN name');
      const principal = await identity.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
      assert.equal(database.records[0]?.get('name'), 'isn-test');
      assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
      assert.deepEqual([...principal.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
      const deniedDev = driver.session({ database: 'isn-dev' });
      try {
        await assert.rejects(deniedDev.run('CALL db.ping()'), (error) =>
          /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
      } finally {
        await deniedDev.close();
      }

      const markerResult = await identity.run(
        "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
      );
      assert.equal(asNumber(markerResult.records[0]?.get('version')), 3);
      const history = await identity.run(
        'MATCH (migration:ISNSchemaMigration) RETURN migration.version AS version, migration.name AS name, migration.checksum AS checksum, migration.status AS status, migration.appliedAt IS NOT NULL AS applied, migration.verifiedAt IS NOT NULL AS verified ORDER BY version',
      );
      assert.deepEqual(history.records.map((record) => [
        asNumber(record.get('version')), record.get('name'), record.get('checksum'),
        record.get('status'), record.get('applied'), record.get('verified'),
      ]), [
        [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2', 'VERIFIED', true, true],
        [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de', 'VERIFIED', true, true],
        [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee', 'VERIFIED', true, true],
      ]);
      const constraints = await identity.run(
        'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
      );
      const expectedConstraints = [
        ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'ISNSchema', 'key'],
        ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'ISNSchemaMigration', 'version'],
        ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'User', 'id'],
        ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'User', 'email'],
        ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'AuthSession', 'id'],
        ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'AuthSession', 'jti'],
        ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'AuthActivityEvent', 'eventId'],
      ];
      assert.equal(constraints.records.length, expectedConstraints.length);
      for (const [name, type, label, property] of expectedConstraints) {
        assert.ok(constraints.records.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === 'NODE' &&
          JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
          JSON.stringify(record.get('properties')) === JSON.stringify([property])));
      }
      const indexes = await identity.run(
        'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
      );
      const expectedIndexes = [
        ['isn_auth_event_id', 'RANGE', 'AuthActivityEvent', 'eventId'],
        ['isn_auth_session_id', 'RANGE', 'AuthSession', 'id'],
        ['isn_auth_session_jti', 'RANGE', 'AuthSession', 'jti'],
        ['isn_auth_session_expires_at', 'RANGE', 'AuthSession', 'expiresAt'],
        ['isn_auth_event_timestamp', 'RANGE', 'AuthActivityEvent', 'timestamp'],
        ['isn_schema_metadata_key', 'RANGE', 'ISNSchema', 'key'],
        ['isn_schema_migration_version', 'RANGE', 'ISNSchemaMigration', 'version'],
        ['isn_user_email', 'RANGE', 'User', 'email'],
        ['isn_user_id', 'RANGE', 'User', 'id'],
        ['isn_user_display_name_search', 'TEXT', 'User', 'displayNameSearch'],
      ];
      const applicationIndexes = indexes.records.filter((record) => record.get('type') !== 'LOOKUP');
      assert.equal(applicationIndexes.length, expectedIndexes.length);
      for (const [name, type, label, property] of expectedIndexes) {
        assert.ok(applicationIndexes.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === 'NODE' &&
          JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
          JSON.stringify(record.get('properties')) === JSON.stringify([property]) &&
          record.get('state') === 'ONLINE'));
      }

      const conflicts = await identity.run(
        'MATCH (user:User) WHERE user.id IN $ids OR user.email IN $emails RETURN count(user) AS count',
        { ids: fixtureUserIds, emails },
      );
      assert.equal(conflicts.records[0].get('count').toNumber(), 0, 'synthetic fixture identities must not already exist');
      baselineCounts = await readCounts(identity);
      targetVerified = true;
    } finally {
      await identity.close();
    }

    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');

    await mkdir(resolve('.artifacts'), { recursive: true });
    authKeyDirectory = await mkdtemp(resolve('.artifacts/neo4j-profile-keys-'));
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const privateKeyPath = resolve(authKeyDirectory, 'private.pem');
    const publicKeyPath = resolve(authKeyDirectory, 'public.pem');
    const csrfSecretPath = resolve(authKeyDirectory, 'csrf.secret');
    await Promise.all([
      writeFile(privateKeyPath, privateKey, { mode: 0o600 }),
      writeFile(publicKeyPath, publicKey, { mode: 0o600 }),
      writeFile(csrfSecretPath, randomBytes(32), { mode: 0o600 }),
    ]);
    Object.assign(process.env, {
      AUTH_PRIVATE_KEY_PATH: privateKeyPath,
      AUTH_PUBLIC_KEY_PATH: publicKeyPath,
      AUTH_CSRF_SECRET_PATH: csrfSecretPath,
      AUTH_KEY_ID: 'neo4j-profile-integration',
      AUTH_ISSUER: 'http://127.0.0.1:3000',
      AUTH_AUDIENCE: 'intelligent-social-network-web',
      AUTH_WEB_ORIGIN: 'http://127.0.0.1:3000',
    });

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../../apps/api/dist/app.module.js');
    const { AuthSecurityService } = await import('../../../apps/api/dist/modules/auth/auth-security.service.js');
    const { configureAuthHttp } = await import('../../../apps/api/dist/modules/auth/auth-http.js');

    const neo4jService = new Neo4jService(driver, 'isn-test');
    const authRepository = new AuthRepository(neo4jService);
    const passwordHash = await new PasswordService().hash(password);
    const registeredAt = new Date().toISOString();
    for (const [index, email] of emails.entries()) {
      const userId = fixtureUserIds[index];
      assert.ok(userId);
      fixtureManifests.set(userId, { email, path: await recordFixtureOwnership(email, userId) });
    }
    for (let index = 0; index < fixtureUserIds.length; index += 1) {
      const id = fixtureUserIds[index];
      const email = emails[index];
      assert.ok(id && email);
      await authRepository.register({ id, email, passwordHash, eventId: randomUUID(), now: registeredAt });
      const manifest = fixtureManifests.get(id);
      assert.ok(manifest);
      await updateFixtureOwnership(manifest.path, email, id);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureAuthHttp(app, moduleRef.get(AuthSecurityService), process.env.AUTH_WEB_ORIGIN);
    await app.init();

    for (const email of emails) {
      const agent = request.agent(app.getHttpServer());
      const bootstrap = await agent.get('/auth/csrf').expect(200);
      const login = await agent.post('/auth/login')
        .set('Origin', process.env.AUTH_WEB_ORIGIN)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email, password })
        .expect(200);
      assert.equal(login.body.user.email, email);
      const csrf = await agent.get('/auth/csrf').expect(200);
      agents.push({ agent, csrfToken: csrf.body.csrfToken });
    }

    const [ownerId, secondId, thirdId] = fixtureUserIds;
    const owner = agents[0];
    const secondMember = agents[1];
    assert.ok(owner && secondMember && ownerId && secondId && thirdId);

    const ownBefore = await owner.agent.get('/users/me/profile').expect(200);
    assert.deepEqual(ownBefore.body.profile, {
      id: ownerId,
      displayName: `Thành viên ${ownerId.slice(0, 8)}`,
      bio: null,
      location: null,
      createdAt: ownBefore.body.profile.createdAt,
      updatedAt: ownBefore.body.profile.updatedAt,
      version: 0,
    });
    assert.ok(Number.isFinite(Date.parse(ownBefore.body.profile.createdAt)));
    const beforeReads = await readUserSnapshot(driver, ownerId);
    await owner.agent.get('/users/me/profile').expect(200);
    await owner.agent.get('/users/me/profile').expect(200);
    assert.deepEqual(await readUserSnapshot(driver, ownerId), beforeReads,
      'repeated profile GETs must not mutate user, session, or auth-event records');

    for (const [index, fixtureId] of fixtureUserIds.entries()) {
      const target = agents[index];
      assert.ok(target && fixtureId);
      const displayName = `${marker} Nguyễn ${['An', 'Bình', 'Chi'][index]}`;
      await target.agent.patch('/users/me/profile')
        .set('Origin', process.env.AUTH_WEB_ORIGIN)
        .set('X-CSRF-Token', target.csrfToken)
        .send({ displayName, bio: `Synthetic ${index}`, location: null, expectedVersion: 0 })
        .expect(200);
    }

    const publicProfile = await secondMember.agent.get(`/users/${ownerId}/profile`).expect(200);
    assert.deepEqual(Object.keys(publicProfile.body.profile).sort(), ['bio', 'displayName', 'id', 'location']);
    assert.deepEqual(publicProfile.body.profile, {
      id: ownerId, displayName: `${marker} Nguyễn An`, bio: 'Synthetic 0', location: null,
    });

    const firstPage = await owner.agent.get('/users')
      .query({ q: `${marker} NGUYEN`, limit: 1 })
      .expect(200);
    assert.equal(firstPage.body.items.length, 1);
    assert.equal(firstPage.body.items[0].id, [secondId, thirdId].sort()[0]);
    assert.equal(firstPage.body.pagination.hasMore, true);
    assert.equal(typeof firstPage.body.pagination.nextCursor, 'string');
    const secondPage = await owner.agent.get('/users')
      .query({ q: `${marker} nguyen`, limit: 1, cursor: firstPage.body.pagination.nextCursor })
      .expect(200);
    assert.equal(secondPage.body.items.length, 1);
    assert.equal(secondPage.body.items[0].id, [secondId, thirdId].sort()[1]);
    assert.equal(secondPage.body.pagination.hasMore, false);
    assert.equal(secondPage.body.pagination.nextCursor, null);

    const updateVersion = (await owner.agent.get('/users/me/profile').expect(200)).body.profile.version;
    const concurrentUpdates = await Promise.all([
      owner.agent.patch('/users/me/profile')
        .set('Origin', process.env.AUTH_WEB_ORIGIN)
        .set('X-CSRF-Token', owner.csrfToken)
        .send({ displayName: `${marker} winner`, expectedVersion: updateVersion }),
      owner.agent.patch('/users/me/profile')
        .set('Origin', process.env.AUTH_WEB_ORIGIN)
        .set('X-CSRF-Token', owner.csrfToken)
        .send({ bio: 'Concurrent winner', expectedVersion: updateVersion }),
    ]);
    assert.deepEqual(concurrentUpdates.map((response) => response.status).sort(), [200, 409]);
    const conflict = concurrentUpdates.find((response) => response.status === 409);
    assert.equal(conflict?.body?.error?.code, 'PROFILE_CONFLICT');

    const finalProfile = await owner.agent.get('/users/me/profile').expect(200);
    assert.equal(finalProfile.body.profile.version, updateVersion + 1);
    const displayNameWon = finalProfile.body.profile.displayName === `${marker} winner`;
    const bioWon = finalProfile.body.profile.bio === 'Concurrent winner';
    assert.notEqual(displayNameWon, bioWon, 'exactly one concurrent update must be visible');
    assert.equal(finalProfile.body.profile.displayName, displayNameWon ? `${marker} winner` : `${marker} Nguyễn An`);
    assert.equal(finalProfile.body.profile.bio, bioWon ? 'Concurrent winner' : 'Synthetic 0');

    const authState = await driver.session({ database: 'isn-test' });
    try {
      const stored = await authState.run(
        'MATCH (user:User {id: $id}) RETURN user.email AS email, user.passwordHash AS passwordHash',
        { id: ownerId },
      );
      assert.equal(stored.records[0]?.get('email'), emails[0]);
      assert.equal(stored.records[0]?.get('passwordHash'), passwordHash);
    } finally {
      await authState.close();
    }
  } finally {
    if (app) await app.close();
    if (targetVerified) {
      const cleanup = driver.session({ database: 'isn-test' });
      try {
        for (const [userId, fixture] of fixtureManifests) {
          const removed = await removeOwnedFixture(cleanup, fixture.email, userId);
          assert.ok(removed.users === 0 || removed.users === 1);
          await removeFixtureManifest(fixture.path);
        }
        assert.deepEqual(await readCounts(cleanup), baselineCounts, 'unrelated database records must remain unchanged');
      } finally {
        await cleanup.close();
      }
    }
    await driver.close();
    for (const key of authEnvironmentKeys) {
      const previous = previousAuthEnvironment.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    if (authKeyDirectory) await rm(authKeyDirectory, { recursive: true, force: true });
  }
});

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}

async function readCounts(session) {
  const result = await session.run(
    `CALL { MATCH (user:User) RETURN count(user) AS users }
     CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
     CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
     RETURN users, sessions, events`,
  );
  return {
    users: countAsNumber(result.records[0]?.get('users')),
    sessions: countAsNumber(result.records[0]?.get('sessions')),
    events: countAsNumber(result.records[0]?.get('events')),
  };
}

async function readUserSnapshot(driver, userId) {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (user:User {id: $userId})
       OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
       WITH user, collect(DISTINCT authSession.jti) AS sessions
       OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
       RETURN user.id AS id, user.email AS email, user.passwordHash AS passwordHash,
              toString(user.createdAt) AS createdAt,
              user.displayName AS displayName, user.bio AS bio, user.location AS location,
              user.displayNameSearch AS searchKey,
              toString(user.profileCreatedAt) AS profileCreatedAt,
              toString(user.profileUpdatedAt) AS profileUpdatedAt,
              user.profileVersion AS version, sessions,
              collect(DISTINCT event.eventId) AS eventIds,
              collect(DISTINCT event.eventType) AS eventTypes`, { userId },
    );
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    return {
      id: record.get('id'), email: record.get('email'), passwordHash: record.get('passwordHash'),
      createdAt: record.get('createdAt'), displayName: record.get('displayName'),
      bio: record.get('bio'), location: record.get('location'), searchKey: record.get('searchKey'),
      profileCreatedAt: record.get('profileCreatedAt'), profileUpdatedAt: record.get('profileUpdatedAt'),
      version: asNumber(record.get('version')),
      sessions: [...record.get('sessions')].sort(),
      eventIds: [...record.get('eventIds')].sort(),
      eventTypes: [...record.get('eventTypes')].sort(),
    };
  } finally {
    await session.close();
  }
}
