import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  countAsNumber,
  recordFixtureOwnership,
  removeFixtureManifest,
  removeOwnedFixture,
  updateFixtureOwnership,
} from './fixture-ownership.mjs';

test('real isn-test authentication persistence is atomic, session-backed and safely fixture-owned', async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'Set NODE_ENV=test before real authentication integration');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test', 'Authentication integration never falls back from isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD,
    'Configure NEO4J_URI and dedicated test credentials in apps/api/.env.test.local');
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD,
    'Do not provide development administrator credentials to real integration tests');

  const neo4j = await import('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  let targetVerified = false;
  let stage = 'preflight';
  const fixtureManifests = new Map();
  let baselineCounts;
  await mkdir(resolve('.artifacts'), { recursive: true });
  const authKeyDirectory = await mkdtemp(resolve('.artifacts/neo4j-auth-keys-'));

  try {
    await driver.verifyConnectivity();
    const identity = driver.session({ database: 'isn-test' });
    try {
      const database = await identity.run('CALL db.info() YIELD name RETURN name');
      const user = await identity.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
      assert.equal(database.records[0]?.get('name'), 'isn-test');
      assert.equal(user.records[0]?.get('username'), 'isn_test_runner');
      assert.deepEqual([...user.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
      const dev = driver.session({ database: 'isn-dev' });
      try {
        await assert.rejects(dev.run('CALL db.ping()'), (error) =>
          /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
      } finally {
        await dev.close();
      }
      const history = await identity.run(
        'MATCH (migration:ISNSchemaMigration) RETURN migration.version AS version, migration.name AS name, migration.checksum AS checksum, migration.status AS status, migration.appliedAt IS NOT NULL AS applied, migration.verifiedAt IS NOT NULL AS verified ORDER BY version',
      );
      assert.deepEqual(history.records.map((record) => [
        countAsNumber(record.get('version')), record.get('name'), record.get('checksum'),
        record.get('status'), record.get('applied'), record.get('verified'),
      ]), [
        [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2', 'VERIFIED', true, true],
        [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de', 'VERIFIED', true, true],
        [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee', 'VERIFIED', true, true],
        [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2', 'VERIFIED', true, true],
      ]);
      const marker = await identity.run(
        "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
      );
      assert.equal(countAsNumber(marker.records[0]?.get('version')), 4);
      const constraints = await identity.run(
        'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
      );
      const expectedConstraints = [
        ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchema', 'key'],
        ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchemaMigration', 'version'],
        ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', 'id'],
        ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', 'email'],
        ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', 'id'],
        ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', 'jti'],
        ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthActivityEvent', 'eventId'],
        ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', 'pairKey'],
        ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', 'requestId'],
        ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', 'id'],
        ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', 'pairKey'],
      ];
      assert.equal(constraints.records.length, expectedConstraints.length);
      for (const [name, type, entityType, label, property] of expectedConstraints) {
        assert.ok(constraints.records.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === entityType &&
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
        ['isn_friendship_pair_key', 'RANGE', 'FriendshipPair', ['pairKey']],
        ['isn_friendship_request_id', 'RANGE', 'FriendshipPair', ['requestId']],
        ['isn_friendship_id', 'RANGE', 'FRIEND_WITH', ['id']],
        ['isn_friendship_edge_pair_key', 'RANGE', 'FRIEND_WITH', ['pairKey']],
        ['isn_friendship_requests_sent', 'RANGE', 'FriendshipPair', ['senderId', 'requestStatus', 'requestId']],
        ['isn_friendship_requests_received', 'RANGE', 'FriendshipPair', ['recipientId', 'requestStatus', 'requestId']],
      ];
      const applicationIndexes = indexes.records.filter((record) => record.get('type') !== 'LOOKUP');
      assert.equal(applicationIndexes.length, expectedIndexes.length);
      for (const [name, type, label, properties] of expectedIndexes) {
        assert.ok(applicationIndexes.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === (label === 'FRIEND_WITH' ? 'RELATIONSHIP' : 'NODE') &&
          JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
          JSON.stringify(record.get('properties')) === JSON.stringify(Array.isArray(properties) ? properties : [properties]) &&
          record.get('state') === 'ONLINE'));
      }
      const invalidProfiles = await identity.run(
        `MATCH (profile:User)
         WHERE profile.id IS NULL OR profile.displayName IS NULL OR size(profile.displayName) < 2 OR
               size(profile.displayName) > 80 OR profile.displayNameSearch IS NULL OR
               profile.profileCreatedAt IS NULL OR profile.profileUpdatedAt IS NULL OR
               profile.profileVersion IS NULL OR profile.profileVersion < 0
         RETURN count(profile) AS count`,
      );
      assert.equal(countAsNumber(invalidProfiles.records[0]?.get('count')), 0);
      baselineCounts = await readCounts(identity);
      targetVerified = true;
    } finally {
      await identity.close();
    }

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

    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const { JwtService } = await import('../../../apps/api/dist/modules/auth/jwt.service.js');
    const configModule = await import('@nestjs/config');
    const neo4jService = new Neo4jService(driver, 'isn-test');
    const repository = new AuthRepository(neo4jService);
    const passwords = new PasswordService();
    const userId = randomUUID();
    const email = `profile-${randomUUID()}@example.invalid`;
    const password = 'synthetic integration test password';
    const passwordHash = await passwords.hash(password);
    const registeredAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const registerEventId = randomUUID();
    const primaryManifest = await recordFixtureOwnership(email, userId);
    fixtureManifests.set(email, { email, userId, path: primaryManifest });

    stage = 'registration';
    const registered = await repository.register({
      id: userId, email, passwordHash, eventId: registerEventId, now: registeredAt,
    });
    await updateFixtureOwnership(primaryManifest, email, registered.id);
    assert.deepEqual(registered, { id: userId, email });
    const credentials = await repository.findCredentials(email);
    assert.ok(credentials);
    assert.equal(credentials.passwordHash, passwordHash);
    assert.equal(await passwords.verify(credentials.passwordHash, password), true);

    stage = 'duplicate-registration';
    await assert.rejects(repository.register({
      id: randomUUID(), email, passwordHash, eventId: randomUUID(), now: registeredAt,
    }), { name: 'AccountConflictError' });

    const rolledBackId = randomUUID();
    const rollbackEmail = `profile-${randomUUID()}@example.invalid`;
    const rollbackManifest = await recordFixtureOwnership(rollbackEmail, rolledBackId);
    fixtureManifests.set(rollbackEmail, { email: rollbackEmail, userId: rolledBackId, path: rollbackManifest });
    stage = 'registration-atomicity';
    await assert.rejects(repository.register({
      id: rolledBackId, email: rollbackEmail, passwordHash,
      eventId: registerEventId, now: registeredAt,
    }));
    const rollbackCheck = driver.session({ database: 'isn-test' });
    try {
      const absent = await rollbackCheck.run('MATCH (user:User {id: $id}) RETURN count(user) AS count', { id: rolledBackId });
      assert.equal(absent.records[0].get('count').toNumber(), 0, 'failed event creation must roll back its user');
    } finally {
      await rollbackCheck.close();
    }

    const racingEmail = `profile-${randomUUID()}@example.invalid`;
    const raceManifest = await recordFixtureOwnership(racingEmail);
    const raceFixture = { email: racingEmail, path: raceManifest };
    fixtureManifests.set(racingEmail, raceFixture);
    const racingIds = [randomUUID(), randomUUID()];
    stage = 'registration-race';
    const race = await Promise.allSettled(racingIds.map((id) => repository.register({
      id, email: racingEmail, passwordHash, eventId: randomUUID(), now: registeredAt,
    })));
    const winners = race.filter((result) => result.status === 'fulfilled');
    if (winners.length === 1) {
      raceFixture.userId = winners[0].value.id;
      await updateFixtureOwnership(raceManifest, racingEmail, winners[0].value.id);
    }
    assert.equal(winners.length, 1, 'the Neo4j unique email constraint must permit exactly one concurrent registration');
    assert.equal(race.filter((result) => result.status === 'rejected').length, 1);

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((issuedAt + 86_400) * 1000).toISOString();
    const jwt = new JwtService(new configModule.ConfigService({
      AUTH_PRIVATE_KEY_PATH: privateKeyPath,
      AUTH_PUBLIC_KEY_PATH: publicKeyPath,
      AUTH_KEY_ID: 'neo4j-auth-integration',
      AUTH_ISSUER: 'http://127.0.0.1:3000',
      AUTH_AUDIENCE: 'intelligent-social-network-web',
    }));
    await jwt.onModuleInit();
    const jti = randomUUID();
    const sessionId = randomUUID();
    const loginEventId = randomUUID();
    stage = 'session-creation';
    const sessionCreated = await repository.createSession({
      user: registered,
      expectedPasswordHash: passwordHash,
      id: sessionId,
      jti,
      eventId: loginEventId,
      now: new Date(issuedAt * 1000).toISOString(),
      expiresAt,
    });
    assert.equal(sessionCreated, true);
    const token = await jwt.signSession(userId, jti, issuedAt);
    const claims = await jwt.verifySessionToken(token);
    assert.equal(claims.exp, issuedAt + 86_400);
    assert.deepEqual(await repository.findActiveSession(userId, jti, expiresAt), {
      id: userId, email, expiresAt: await expectedStoredDate(driver, userId, jti, expiresAt),
    });

    const duplicateSession = randomUUID();
    stage = 'session-atomicity';
    await assert.rejects(repository.createSession({
      user: registered, expectedPasswordHash: passwordHash, id: duplicateSession,
      jti: randomUUID(), eventId: loginEventId,
      now: new Date(issuedAt * 1000).toISOString(), expiresAt,
    }));
    const sessionRollback = driver.session({ database: 'isn-test' });
    try {
      const absent = await sessionRollback.run('MATCH (session:AuthSession {id: $id}) RETURN count(session) AS count', { id: duplicateSession });
      assert.equal(absent.records[0].get('count').toNumber(), 0, 'failed login event creation must roll back its session');
    } finally {
      await sessionRollback.close();
    }

    stage = 'login-failure-event';
    await repository.recordLoginFailure(email, randomUUID(), new Date(issuedAt * 1000).toISOString());
    stage = 'logout-atomicity';
    await assert.rejects(repository.revokeSession({
      userId, jti, eventId: registerEventId, now: new Date(issuedAt * 1000).toISOString(),
    }));
    assert.ok(await repository.findActiveSession(userId, jti, expiresAt), 'failed logout event must not revoke the session');

    stage = 'concurrent-logout-revocation';
    const lockSession = driver.session({ database: 'isn-test' });
    const lock = lockSession.beginTransaction();
    let revocations;
    try {
      await lock.run(
        `MATCH (session:AuthSession {jti: $jti})
         SET session.expiresAt = session.expiresAt RETURN session.jti`,
        { jti },
      );
      revocations = Promise.all(Array.from({ length: 4 }, () => repository.revokeSession({
        userId, jti, eventId: randomUUID(), now: new Date(issuedAt * 1000).toISOString(),
      })));
      // Hold the write lock while competing queries reach their transition.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await lock.commit();
      assert.equal((await revocations).filter(Boolean).length, 1,
        'simultaneous logout must produce exactly one active-to-revoked transition');
    } finally {
      if (lock.isOpen()) await lock.rollback();
      if (revocations) await revocations.catch(() => undefined);
      await lockSession.close();
    }
    assert.equal(await repository.revokeSession({
      userId, jti, eventId: randomUUID(), now: new Date(issuedAt * 1000).toISOString(),
    }), false, 'logout revocation is durable and idempotent');
    assert.equal(await repository.findActiveSession(userId, jti, expiresAt), undefined,
      'a still-valid signed token must be denied after durable database revocation');

    stage = 'event-verification';
    const eventSession = driver.session({ database: 'isn-test' });
    try {
      const events = await eventSession.run(
        `MATCH (user:User {id: $userId})-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
         RETURN collect(event.eventType) AS types`,
        { userId },
      );
      assert.deepEqual([...events.records[0].get('types')].sort(), [
        'AUTH_LOGIN_FAILED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_REGISTERED',
      ]);
      const storedHash = await eventSession.run('MATCH (user:User {id: $userId}) RETURN user.passwordHash AS hash', { userId });
      assert.equal(storedHash.records[0].get('hash'), passwordHash);
    } finally {
      await eventSession.close();
    }

    console.log(JSON.stringify({
      database: 'isn-test',
      syntheticFixture: true,
      registration: 'persisted',
      duplicateRace: 'one-winner',
      session: 'created-restored-revoked-replay-denied',
      mutationEvents: ['AUTH_REGISTERED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGIN_FAILED', 'AUTH_LOGOUT'],
      atomicRollbackChecks: 3,
      devDatabaseAccess: 'denied',
    }));
  } catch (error) {
    const safeMessage = String(error?.message ?? '')
      .split('\n')[0]
      .replace(/\$argon2[^\s]*/g, '[redacted-hash]')
      .replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]')
      .slice(0, 240);
    console.error(JSON.stringify({ stage, failureName: error?.name ?? 'unknown', failureCode: error?.code ?? 'none', safeMessage }));
    assert.fail('Real authentication integration failed; database credentials and query details are suppressed.');
  } finally {
    try {
      if (targetVerified) {
        const cleanup = driver.session({ database: 'isn-test' });
        try {
          for (const fixture of fixtureManifests.values()) {
            if (!fixture.userId) {
              const uncertain = await cleanup.run(
                'MATCH (user:User {email: $email}) RETURN count(user) AS count', { email: fixture.email },
              );
              assert.equal(countAsNumber(uncertain.records[0]?.get('count')), 0,
                'An interrupted race fixture without a verified UUID is preserved for manual review');
            } else {
              await removeOwnedFixture(cleanup, fixture.email, fixture.userId);
            }
            await removeFixtureManifest(fixture.path);
          }
          assert.deepEqual(await readCounts(cleanup), baselineCounts, 'unrelated database records must remain unchanged');
        } finally {
          await cleanup.close();
        }
      }
    } finally {
      await driver.close();
      await rm(authKeyDirectory, { recursive: true, force: true });
    }
  }
});

async function expectedStoredDate(driver, userId, jti, expected) {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (:User {id: $userId})-[:HAS_AUTH_SESSION]->(authSession:AuthSession {jti: $jti})
       RETURN toString(authSession.expiresAt) AS expiresAt`,
      { userId, jti },
    );
    const stored = result.records[0]?.get('expiresAt');
    assert.ok(typeof stored === 'string');
    assert.equal(Date.parse(stored), Date.parse(expected));
    return stored;
  } finally {
    await session.close();
  }
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
