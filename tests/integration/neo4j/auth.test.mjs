import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

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
  const fixtureUserIds = new Set();
  const fixtureEmails = new Set();
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
      targetVerified = true;
    } finally {
      await identity.close();
    }

    const dev = driver.session({ database: 'isn-dev' });
    try {
      await assert.rejects(dev.run('CALL db.ping()'), (error) =>
        /^Neo\.ClientError\.Security\./.test(String(error?.code ?? '')));
    } finally {
      await dev.close();
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
    const email = `neo4j-auth-${randomUUID()}@example.invalid`;
    const password = 'synthetic integration test password';
    const passwordHash = await passwords.hash(password);
    const registeredAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const registerEventId = randomUUID();
    fixtureEmails.add(email);

    stage = 'registration';
    const registered = await repository.register({
      id: userId, email, passwordHash, eventId: registerEventId, now: registeredAt,
    });
    fixtureUserIds.add(registered.id);
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
    stage = 'registration-atomicity';
    await assert.rejects(repository.register({
      id: rolledBackId, email: `rollback-${randomUUID()}@example.invalid`, passwordHash,
      eventId: registerEventId, now: registeredAt,
    }));
    const rollbackCheck = driver.session({ database: 'isn-test' });
    try {
      const absent = await rollbackCheck.run('MATCH (user:User {id: $id}) RETURN count(user) AS count', { id: rolledBackId });
      assert.equal(absent.records[0].get('count').toNumber(), 0, 'failed event creation must roll back its user');
    } finally {
      await rollbackCheck.close();
    }

    const racingEmail = `race-${randomUUID()}@example.invalid`;
    fixtureEmails.add(racingEmail);
    stage = 'registration-race';
    const race = await Promise.allSettled([0, 1].map(() => repository.register({
      id: randomUUID(), email: racingEmail, passwordHash, eventId: randomUUID(), now: registeredAt,
    })));
    const winners = race.filter((result) => result.status === 'fulfilled');
    assert.equal(winners.length, 1, 'the Neo4j unique email constraint must permit exactly one concurrent registration');
    fixtureUserIds.add(winners[0].value.id);
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
    if (targetVerified) {
      const cleanup = driver.session({ database: 'isn-test' });
      try {
        for (const userId of fixtureUserIds) {
          await cleanup.run(
            `MATCH (user:User {id: $userId})
             OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
             OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
             WITH user, collect(DISTINCT authSession) AS sessions, collect(DISTINCT event) AS events
             UNWIND [user] + [item IN sessions WHERE item IS NOT NULL] + [item IN events WHERE item IS NOT NULL] AS owned
             DETACH DELETE owned`,
            { userId },
          );
        }
        for (const email of fixtureEmails) {
          await cleanup.run(
            `MATCH (user:User {email: $email})
             OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
             OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
             WITH user, collect(DISTINCT authSession) AS sessions, collect(DISTINCT event) AS events
             UNWIND [user] + [item IN sessions WHERE item IS NOT NULL] + [item IN events WHERE item IS NOT NULL] AS owned
             DETACH DELETE owned`,
            { email },
          );
        }
      } finally {
        await cleanup.close();
      }
    }
    await driver.close();
    await rm(authKeyDirectory, { recursive: true, force: true });
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
