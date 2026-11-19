import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import acceptanceSupport from '../../fixtures/friendships/acceptance-support.cjs';

const {
  assertGraphInvariants,
  captureBaseline,
  cleanupRun,
  recordRunFriendship,
  recordRunRequest,
  registerOwnedFixture,
  refreshOwnedAuthRecords,
  reserveRunFixture,
  reserveRunPair,
  verifyCurrentV4,
  writeRunManifest,
} = acceptanceSupport;

const origin = 'http://127.0.0.1:3000';
const migrationV4Checksum = '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2';

test('real Friendship API preserves pair invariants across lifecycle, retries and concurrent actions', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD,
    'Configure the restricted test identity in apps/api/.env.test.local');
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD,
    'Do not provide administrator credentials to friendship integration');

  const neo4j = await import('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const userIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const emails = userIds.map((id) => `profile-${id}@example.invalid`);
  const password = 'synthetic friendship integration password';
  const actors = new Map();
  let baseline;
  let preservationBaseline;
  let runManifest;
  let runManifestPath;
  let targetVerified = false;
  let app;
  let appNeo4jService;
  let authKeyDirectory;
  const authEnvironmentKeys = [
    'AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH',
    'AUTH_KEY_ID', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_WEB_ORIGIN',
  ];
  const previousAuthEnvironment = new Map(authEnvironmentKeys.map((key) => [key, process.env[key]]));
  const pairKeys = [
    canonicalKey(userIds[0], userIds[1]),
    canonicalKey(userIds[0], userIds[2]),
    canonicalKey(userIds[0], userIds[3]),
    canonicalKey(userIds[2], userIds[3]),
    canonicalKey(userIds[1], userIds[3]),
    canonicalKey(userIds[3], userIds[4]),
  ];

  try {
    await driver.verifyConnectivity();
    const identity = driver.session({ database: 'isn-test' });
    let neo4jService;
    try {
      await verifyCurrentV4(identity);
      const dev = driver.session({ database: 'isn-dev' });
      try {
        await assert.rejects(dev.run('CALL db.ping()'), (error) =>
          /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
      } finally {
        await dev.close();
      }

      const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
      const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
      neo4jService = new Neo4jService(driver, 'isn-test');
      const schema = await new Neo4jMigrationService(neo4jService).getStatus();
      assert.equal(schema.status, 'current', 'V1–V4 history and exact schema catalog must be current before any fixture write');
      assert.equal(schema.version, 4);
      assert.deepEqual(schema.migrations.map(({ version, name, checksum }) => [version, name, checksum]), [
        [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
        [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
        [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
        [4, 'friendship-system', migrationV4Checksum],
      ]);
      const conflicts = await identity.run(
        'MATCH (user:User) WHERE user.id IN $ids OR user.email IN $emails RETURN count(user) AS count',
        { ids: userIds, emails },
      );
      assert.equal(asNumber(conflicts.records[0]?.get('count')), 0);
      const pairConflicts = await identity.run(
        `CALL { MATCH (pair:FriendshipPair) WHERE pair.pairKey IN $pairKeys RETURN count(pair) AS pairs }
         CALL { MATCH ()-[friendship:FRIEND_WITH]-() WHERE friendship.pairKey IN $pairKeys RETURN count(friendship) AS edges }
         RETURN pairs, edges`,
        { pairKeys },
      );
      assert.equal(asNumber(pairConflicts.records[0]?.get('pairs')), 0);
      assert.equal(asNumber(pairConflicts.records[0]?.get('edges')), 0);
      baseline = await readCounts(identity);
      preservationBaseline = await captureBaseline(identity);
      targetVerified = true;
    } finally {
      await identity.close();
    }

    ({ path: runManifestPath, manifest: runManifest } = await writeRunManifest(preservationBaseline));
    for (const [index, email] of emails.entries()) {
      const userId = userIds[index];
      assert.ok(userId);
      await reserveRunFixture(runManifestPath, runManifest, email, userId);
    }
    for (const [firstId, secondId] of [
      [userIds[0], userIds[1]], [userIds[0], userIds[2]], [userIds[0], userIds[3]],
      [userIds[2], userIds[3]], [userIds[1], userIds[3]], [userIds[3], userIds[4]],
    ]) {
      assert.ok(firstId && secondId);
      await reserveRunPair(runManifestPath, runManifest, firstId, secondId);
    }

    await mkdir(resolve('.artifacts'), { recursive: true });
    authKeyDirectory = await mkdtemp(resolve('.artifacts/neo4j-friendship-keys-'));
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
      AUTH_KEY_ID: 'neo4j-friendship-integration',
      AUTH_ISSUER: origin,
      AUTH_AUDIENCE: 'intelligent-social-network-web',
      AUTH_WEB_ORIGIN: origin,
    });

    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../../apps/api/dist/app.module.js');
    const { AuthSecurityService } = await import('../../../apps/api/dist/modules/auth/auth-security.service.js');
    const { configureAuthHttp } = await import('../../../apps/api/dist/modules/auth/auth-http.js');
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    neo4jService = new Neo4jService(driver, 'isn-test');
    const authRepository = new AuthRepository(neo4jService);
    const passwordHash = await new PasswordService().hash(password);
    const registeredAt = new Date().toISOString();

    for (let index = 0; index < userIds.length; index += 1) {
      const id = userIds[index];
      const email = emails[index];
      assert.ok(id && email);
      await authRepository.register({ id, email, passwordHash, eventId: randomUUID(), now: registeredAt });
      const ownership = driver.session({ database: 'isn-test' });
      try {
        await registerOwnedFixture(ownership, runManifest, runManifestPath, email, id);
      } finally {
        await ownership.close();
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureAuthHttp(app, moduleRef.get(AuthSecurityService), origin);
    await app.init();
    appNeo4jService = moduleRef.get(Neo4jService);
    const ready = await request(app.getHttpServer()).get('/ready').expect(200);
    assert.equal(ready.body.schemaVersion, 4);

    for (let index = 0; index < emails.length; index += 1) {
      const email = emails[index];
      const id = userIds[index];
      assert.ok(email && id);
      const agent = request.agent(app.getHttpServer());
      const csrf = await agent.get('/auth/csrf').expect(200);
      const login = await agent.post('/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ email, password })
        .expect(200);
      assert.equal(login.body.user.id, id);
      actors.set(id, { agent, csrfToken: login.body.csrfToken, userId: id });
      const ownership = driver.session({ database: 'isn-test' });
      try {
        await refreshOwnedAuthRecords(ownership, runManifest, runManifestPath,
          runManifest.fixtures.find((fixture) => fixture.userId === id));
      } finally {
        await ownership.close();
      }
    }

    const [aliceId, bobId, caraId, deeId, rateId, limitId] = userIds;
    assert.ok(aliceId && bobId && caraId && deeId && rateId && limitId);
    const alice = actors.get(aliceId);
    const bob = actors.get(bobId);
    const cara = actors.get(caraId);
    const dee = actors.get(deeId);
    const rateActor = actors.get(rateId);
    const limitActor = actors.get(limitId);
    assert.ok(alice && bob && cara && dee && rateActor && limitActor);

    const anonymousList = await request(app.getHttpServer()).get('/friendships').expect(401);
    assert.equal(anonymousList.headers['cache-control'], 'no-store');
    const duplicateRun = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      createTrackedRequest(alice, bobId, runManifestPath, runManifest),
      createTrackedRequest(alice, bobId, runManifestPath, runManifest),
    ]));
    const duplicate = duplicateRun.value;
    assert.deepEqual(duplicate.map((result) => result.status).sort(), [201, 409]);
    assert.equal(duplicateRun.distinctTransactions, 2);
    assert.equal(duplicateRun.enteredCallbacks, 2);
    assert.equal(duplicate.find((result) => result.status === 409)?.body.error.code, 'REQUEST_ALREADY_PENDING');
    const created = duplicate.find((result) => result.status === 201);
    assert.ok(created);
    const requestId = created.body.request.id;
    assert.notEqual(requestId, undefined);
    assert.equal(created.body.request.senderId, aliceId);
    assert.equal(created.body.request.recipientId, bobId);
    assert.equal(created.body.request.status, 'PENDING');
    assert.deepEqual(Object.keys(created.body.request).sort(), ['createdAt', 'id', 'recipientId', 'resolvedAt', 'senderId', 'status']);
    assert.equal(created.body.relationship.state, 'outgoing_pending');
    assert.deepEqual(Object.keys(created.body.relationship).sort(), ['friendsSince', 'friendshipId', 'memberId', 'requestId', 'state']);
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'PENDING', null, 0);
    await assertWholeGraph(driver);
    const sequentialDuplicate = await createTrackedRequest(alice, bobId, runManifestPath, runManifest);
    assert.equal(sequentialDuplicate.status, 409);
    assert.equal(sequentialDuplicate.body.error.code, 'REQUEST_ALREADY_PENDING');
    const reversedDuplicate = await createTrackedRequest(bob, aliceId, runManifestPath, runManifest);
    assert.equal(reversedDuplicate.status, 409);
    assert.equal(reversedDuplicate.body.error.code, 'INCOMING_REQUEST_EXISTS');
    const stateBeforeAuthorizationChecks = await readFixtureSnapshot(driver, pairKeys);
    const invalidOrigin = await alice.agent.post('/friendships/requests')
      .set('Origin', 'https://not-weylume.invalid').set('X-CSRF-Token', alice.csrfToken)
      .send({ recipientId: bobId }).expect(403);
    assert.equal(invalidOrigin.body.error.code, 'CSRF_FAILED');
    assert.equal(invalidOrigin.headers['cache-control'], 'no-store');
    const invalidCsrf = await alice.agent.post('/friendships/requests')
      .set('Origin', origin).set('X-CSRF-Token', 'invalid-token')
      .send({ recipientId: bobId }).expect(403);
    assert.equal(invalidCsrf.body.error.code, 'CSRF_FAILED');
    const wrongContentType = await alice.agent.post('/friendships/requests')
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken)
      .set('Content-Type', 'text/plain').send('{"recipientId":"ignored"}').expect(415);
    assert.equal(wrongContentType.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(wrongContentType.headers['cache-control'], 'no-store');
    const malformedJson = await alice.agent.post('/friendships/requests')
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken)
      .set('Content-Type', 'application/json').send('{').expect(400);
    assert.equal(malformedJson.body.error.code, 'BAD_REQUEST');
    assert.equal(malformedJson.headers['cache-control'], 'no-store');
    const oversizedJson = await alice.agent.post('/friendships/requests')
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken)
      .send({ recipientId: bobId, extra: 'x'.repeat(9_000) }).expect(413);
    assert.equal(oversizedJson.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(oversizedJson.headers['cache-control'], 'no-store');
    const invalidDto = await post(alice, '/friendships/requests', { recipientId: bobId, senderId: bobId });
    assert.equal(invalidDto.status, 422);
    assert.equal(invalidDto.body.error.code, 'VALIDATION_ERROR');
    assert.equal(invalidDto.headers['cache-control'], 'no-store');
    await alice.agent.get('/friendships?limit=invalid').expect(422);
    await alice.agent.get('/friendships/status/not-a-uuid').expect(422);
    assert.deepEqual(await readFixtureSnapshot(driver, pairKeys), stateBeforeAuthorizationChecks,
      'CSRF, content-type, parser, payload, validation and malformed-ID failures must not change graph state');
    await assertWholeGraph(driver);

    const aliceSent = await alice.agent.get('/friendships/requests?direction=sent').expect(200);
    const bobReceived = await bob.agent.get('/friendships/requests?direction=received').expect(200);
    const caraReceived = await cara.agent.get('/friendships/requests?direction=received').expect(200);
    assert.equal(aliceSent.body.items.length, 1);
    assert.equal(bobReceived.body.items.length, 1);
    assert.equal(caraReceived.body.items.length, 0);
    assert.equal('email' in bobReceived.body.items[0].member, false);
    assert.deepEqual(Object.keys(bobReceived.body.items[0].member).sort(), ['bio', 'displayName', 'id', 'location']);
    assert.equal(bobReceived.headers['cache-control'], 'no-store');
    assert.doesNotMatch(JSON.stringify(bobReceived.body), /password|email|session|event|neo4j|elementId|internalId/iu);
    assert.equal((await status(alice, bobId)).body.relationship.state, 'outgoing_pending');
    assert.equal((await status(bob, aliceId)).body.relationship.state, 'incoming_pending');
    assert.equal((await status(dee, aliceId)).body.relationship.state, 'none');
    const versionBeforeUnauthorizedActions = asNumber((await readPairState(driver, pairKeys[0])).version);
    const wrongOwnerAccept = await post(alice, `/friendships/requests/${requestId}/accept`, {});
    assert.equal(wrongOwnerAccept.status, 403);
    assert.equal(wrongOwnerAccept.body.error.code, 'FRIENDSHIP_ACTION_FORBIDDEN');
    assert.equal(wrongOwnerAccept.headers['cache-control'], 'no-store');
    const hiddenRequest = await post(cara, `/friendships/requests/${requestId}/accept`, {});
    assert.equal(hiddenRequest.status, 404);
    assert.equal(hiddenRequest.body.error.code, 'REQUEST_NOT_FOUND');
    assert.equal(hiddenRequest.headers['cache-control'], 'no-store');
    const afterUnauthorizedActions = await readPairState(driver, pairKeys[0]);
    assert.equal(asNumber(afterUnauthorizedActions.version), versionBeforeUnauthorizedActions + 2,
      'The pair lock may advance internally while rejected actions leave business state unchanged');
    assert.deepEqual(
      [afterUnauthorizedActions.requestId, afterUnauthorizedActions.senderId, afterUnauthorizedActions.recipientId,
        afterUnauthorizedActions.requestStatus, afterUnauthorizedActions.friendshipId],
      [requestId, aliceId, bobId, 'PENDING', null],
    );
    assert.equal((await cara.agent.get('/friendships/requests?direction=sent').expect(200)).body.items.length, 0);

    const acceptanceRace = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      post(bob, `/friendships/requests/${requestId}/accept`, {}),
      post(bob, `/friendships/requests/${requestId}/accept`, {}),
    ]));
    const acceptance = acceptanceRace.value;
    assert.ok(acceptanceRace.enteredCallbacks >= 2);
    assert.ok(acceptanceRace.distinctTransactions >= 2);
    assert.deepEqual(acceptance.map((result) => result.status), [200, 200]);
    const firstFriendshipId = acceptance[0].body.request && acceptance[0].body.relationship.friendshipId;
    assert.match(firstFriendshipId, /^[0-9a-f-]{36}$/iu);
    await recordRunFriendship(runManifestPath, runManifest, pairKeys[0], firstFriendshipId);
    assert.equal(acceptance[1].body.relationship.friendshipId, firstFriendshipId);
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'ACCEPTED', firstFriendshipId, 1);
    await assertWholeGraph(driver);
    assert.equal((await status(alice, bobId)).body.relationship.state, 'friends');
    assert.equal((await alice.agent.get('/friendships').expect(200)).body.items[0].friendshipId, firstFriendshipId);
    assert.equal((await bob.agent.get('/friendships').expect(200)).body.items[0].member.id, aliceId);
    assert.equal((await dee.agent.get('/friendships').expect(200)).body.items.length, 0);
    const alreadyFriends = await createTrackedRequest(alice, bobId, runManifestPath, runManifest);
    assert.equal(alreadyFriends.status, 409);
    assert.equal(alreadyFriends.body.error.code, 'ALREADY_FRIENDS');
    assert.equal(alreadyFriends.headers['cache-control'], 'no-store');

    await alice.agent.delete(`/friendships/${firstFriendshipId}`)
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken).expect(204);
    assert.equal((await status(alice, bobId)).body.relationship.state, 'none');
    const secondRequest = await createTrackedRequest(alice, bobId, runManifestPath, runManifest);
    assert.equal(secondRequest.status, 201);
    assert.notEqual(secondRequest.body.request.id, requestId);
    const secondAcceptance = await post(bob, `/friendships/requests/${secondRequest.body.request.id}/accept`, {});
    assert.equal(secondAcceptance.status, 200);
    const secondFriendshipId = secondAcceptance.body.relationship.friendshipId;
    await recordRunFriendship(runManifestPath, runManifest, pairKeys[0], secondFriendshipId);
    assert.notEqual(secondFriendshipId, firstFriendshipId);
    const nonparticipantDelete = await dee.agent.delete(`/friendships/${secondFriendshipId}`)
      .set('Origin', origin).set('X-CSRF-Token', dee.csrfToken).expect(204);
    assert.equal(nonparticipantDelete.headers['cache-control'], 'no-store');
    assert.equal((await status(alice, bobId)).body.relationship.friendshipId, secondFriendshipId,
      'A nonparticipant DELETE must not change the current friendship');
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'ACCEPTED', secondFriendshipId, 1);
    const deleteWithBody = await alice.agent.delete(`/friendships/${secondFriendshipId}`)
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken).send({ unexpected: true });
    assert.equal(deleteWithBody.status, 422);
    assert.equal(deleteWithBody.headers['cache-control'], 'no-store');
    assert.equal((await status(alice, bobId)).body.relationship.friendshipId, secondFriendshipId);
    await alice.agent.delete(`/friendships/${firstFriendshipId}`)
      .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken).expect(204);
    assert.equal((await status(alice, bobId)).body.relationship.friendshipId, secondFriendshipId);
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'ACCEPTED', secondFriendshipId, 1);

    const cancelledRace = await Promise.all([
      createTrackedRequest(rateActor, deeId, runManifestPath, runManifest),
      createTrackedRequest(rateActor, deeId, runManifestPath, runManifest),
    ]);
    assert.deepEqual(cancelledRace.map((result) => result.status).sort(), [201, 409]);
    assert.equal(cancelledRace.find((result) => result.status === 409)?.body.error.code, 'REQUEST_ALREADY_PENDING');
    const cancelledRequest = cancelledRace.find((result) => result.status === 201);
    assert.ok(cancelledRequest);
    assert.equal(cancelledRequest.status, 201);
    const cancelled = await post(rateActor, `/friendships/requests/${cancelledRequest.body.request.id}/cancel`, {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.request.status, 'CANCELLED');
    const cancelRetry = await post(rateActor, `/friendships/requests/${cancelledRequest.body.request.id}/cancel`, {});
    assert.equal(cancelRetry.status, 200);
    assert.equal(cancelRetry.body.request.id, cancelledRequest.body.request.id);
    const contradictoryTerminalAction = await post(dee, `/friendships/requests/${cancelledRequest.body.request.id}/accept`, {});
    assert.equal(contradictoryTerminalAction.status, 409);
    assert.equal(contradictoryTerminalAction.body.error.code, 'FRIENDSHIP_STATE_CONFLICT');
    assert.equal((await status(rateActor, deeId)).body.relationship.state, 'none');
    await assertCanonicalPair(driver, pairKeys[5], rateId, deeId, 'CANCELLED', null, 0);
    await assertWholeGraph(driver);

    const restartedRequest = await createTrackedRequest(rateActor, deeId, runManifestPath, runManifest);
    assert.equal(restartedRequest.status, 201);
    assert.notEqual(restartedRequest.body.request.id, cancelledRequest.body.request.id);
    const deeAcceptance = await post(dee, `/friendships/requests/${restartedRequest.body.request.id}/accept`, {});
    assert.equal(deeAcceptance.status, 200);
    const deeFriendshipId = deeAcceptance.body.relationship.friendshipId;
    await recordRunFriendship(runManifestPath, runManifest, pairKeys[5], deeFriendshipId);
    assert.match(deeFriendshipId, /^[0-9a-f-]{36}$/iu);
    await assertCanonicalPair(driver, pairKeys[5], rateId, deeId, 'ACCEPTED', deeFriendshipId, 1);

    const oppositeRace = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      createTrackedRequest(alice, caraId, runManifestPath, runManifest),
      createTrackedRequest(cara, aliceId, runManifestPath, runManifest),
    ]));
    const opposite = oppositeRace.value;
    assert.ok(oppositeRace.enteredCallbacks >= 2);
    assert.ok(oppositeRace.distinctTransactions >= 2);
    assert.deepEqual(opposite.map((result) => result.status).sort(), [201, 409]);
    assert.equal(opposite.find((result) => result.status === 409)?.body.error.code, 'INCOMING_REQUEST_EXISTS');
    const oppositeRequest = opposite.find((result) => result.status === 201);
    assert.ok(oppositeRequest);
    const oppositeSender = oppositeRequest.body.request.senderId;
    const oppositeRecipient = oppositeRequest.body.request.recipientId;
    const oppositePairState = await readPairState(driver, pairKeys[1]);
    assert.equal(oppositePairState.requestStatus, 'PENDING');
    assert.equal(oppositePairState.senderId, oppositeSender);
    assert.equal(oppositePairState.recipientId, oppositeRecipient);
    assert.equal((await status(actors.get(oppositeSender), oppositeRecipient)).body.relationship.state, 'outgoing_pending');
    assert.equal((await status(actors.get(oppositeRecipient), oppositeSender)).body.relationship.state, 'incoming_pending');
    await assertCanonicalPair(driver, pairKeys[1], aliceId, caraId, 'PENDING', null, 0);
    await assertWholeGraph(driver);

    const winnerActor = actors.get(oppositeSender);
    const loserRoleActor = actors.get(oppositeRecipient);
    assert.ok(winnerActor && loserRoleActor);
    const reject = await post(loserRoleActor, `/friendships/requests/${oppositeRequest.body.request.id}/reject`, {});
    assert.equal(reject.status, 200);
    const rejectRetry = await post(loserRoleActor, `/friendships/requests/${oppositeRequest.body.request.id}/reject`, {});
    assert.equal(rejectRetry.status, 200);
    assert.equal(rejectRetry.body.request.id, oppositeRequest.body.request.id);
    const rejectContradiction = await post(loserRoleActor, `/friendships/requests/${oppositeRequest.body.request.id}/accept`, {});
    assert.equal(rejectContradiction.status, 409);
    assert.equal(rejectContradiction.body.error.code, 'FRIENDSHIP_STATE_CONFLICT');
    await assertCanonicalPair(driver, pairKeys[1], aliceId, caraId, 'REJECTED', null, 0);
    await assertWholeGraph(driver);
    assert.equal((await status(alice, caraId)).body.relationship.state, 'none');
    const afterReject = await createTrackedRequest(alice, caraId, runManifestPath, runManifest);
    assert.equal(afterReject.status, 201);
    assert.notEqual(afterReject.body.request.id, oppositeRequest.body.request.id);

    const staleAction = await post(cara, `/friendships/requests/${oppositeRequest.body.request.id}/accept`, {});
    assert.equal(staleAction.status, 404);
    assert.equal((await readPairState(driver, pairKeys[1])).requestId, afterReject.body.request.id);

    const acceptCancelRace = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      post(cara, `/friendships/requests/${afterReject.body.request.id}/accept`, {}),
      post(alice, `/friendships/requests/${afterReject.body.request.id}/cancel`, {}),
    ]));
    const acceptCancel = acceptCancelRace.value;
    assert.ok(acceptCancelRace.enteredCallbacks >= 2);
    assert.ok(acceptCancelRace.distinctTransactions >= 2);
    assert.deepEqual(acceptCancel.map((result) => result.status).sort(), [200, 409]);
    for (const result of acceptCancel) {
      if (result.body.relationship?.friendshipId) {
        await recordRunFriendship(runManifestPath, runManifest, pairKeys[1], result.body.relationship.friendshipId);
      }
    }
    const acceptCancelState = await readPairState(driver, pairKeys[1]);
    assert.ok(acceptCancelState.requestStatus === 'ACCEPTED' || acceptCancelState.requestStatus === 'CANCELLED');
    await assertCanonicalPair(
      driver, pairKeys[1], aliceId, caraId, acceptCancelState.requestStatus,
      acceptCancelState.friendshipId, acceptCancelState.requestStatus === 'ACCEPTED' ? 1 : 0,
    );
    await assertWholeGraph(driver);

    if (acceptCancelState.requestStatus === 'ACCEPTED') {
      await alice.agent.delete(`/friendships/${acceptCancelState.friendshipId}`)
        .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken).expect(204);
    }
    const raceFollowup = await createTrackedRequest(alice, caraId, runManifestPath, runManifest);
    assert.equal(raceFollowup.status, 201);
    const acceptRejectRace = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      post(cara, `/friendships/requests/${raceFollowup.body.request.id}/accept`, {}),
      post(cara, `/friendships/requests/${raceFollowup.body.request.id}/reject`, {}),
    ]));
    const acceptReject = acceptRejectRace.value;
    assert.ok(acceptRejectRace.enteredCallbacks >= 2);
    assert.ok(acceptRejectRace.distinctTransactions >= 2);
    assert.deepEqual(acceptReject.map((result) => result.status).sort(), [200, 409]);
    for (const result of acceptReject) {
      if (result.body.relationship?.friendshipId) {
        await recordRunFriendship(runManifestPath, runManifest, pairKeys[1], result.body.relationship.friendshipId);
      }
    }
    const acceptRejectState = await readPairState(driver, pairKeys[1]);
    assert.ok(acceptRejectState.requestStatus === 'ACCEPTED' || acceptRejectState.requestStatus === 'REJECTED');
    await assertCanonicalPair(
      driver, pairKeys[1], aliceId, caraId, acceptRejectState.requestStatus,
      acceptRejectState.friendshipId, acceptRejectState.requestStatus === 'ACCEPTED' ? 1 : 0,
    );
    await assertWholeGraph(driver);
    if (acceptRejectState.requestStatus === 'ACCEPTED') {
      await cara.agent.delete(`/friendships/${acceptRejectState.friendshipId}`)
        .set('Origin', origin).set('X-CSRF-Token', cara.csrfToken).expect(204);
    }

    const replayRequest = await createTrackedRequest(alice, caraId, runManifestPath, runManifest);
    assert.equal(replayRequest.status, 201);
    assert.notEqual(replayRequest.body.request.id, raceFollowup.body.request.id);
    assert.equal((await post(dee, `/friendships/requests/${replayRequest.body.request.id}/accept`, {})).status, 404);
    assert.equal((await post(alice, `/friendships/requests/${replayRequest.body.request.id}/accept`, {})).status, 403);
    assert.equal((await status(alice, caraId)).body.relationship.state, 'outgoing_pending');
    assert.equal((await status(cara, aliceId)).body.relationship.state, 'incoming_pending');
    assert.equal((await dee.agent.get('/friendships/requests?direction=received').expect(200)).body.items.length, 0);
    assert.equal((await dee.agent.get('/friendships/requests?direction=sent').expect(200)).body.items.length, 0);

    const { FriendshipsRepository } = await import('../../../apps/api/dist/modules/friendships/friendships.repository.js');
    const repository = new FriendshipsRepository(neo4jService);
    await assert.rejects(repository.actOnRequest({
      actorId: caraId,
      requestId: replayRequest.body.request.id,
      action: 'accept',
      friendshipId: secondFriendshipId,
      now: new Date().toISOString(),
    }));
    assert.equal((await status(alice, caraId)).body.relationship.state, 'outgoing_pending');
    await assertCanonicalPair(driver, pairKeys[1], aliceId, caraId, 'PENDING', null, 0);
    const intactFriendship = await readPairState(driver, pairKeys[0]);
    assert.equal(intactFriendship.requestStatus, 'ACCEPTED');
    assert.equal(intactFriendship.friendshipId, secondFriendshipId);
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'ACCEPTED', secondFriendshipId, 1);

    const deeToCara = await createTrackedRequest(dee, caraId, runManifestPath, runManifest);
    assert.equal(deeToCara.status, 201);
    await assertCanonicalPair(driver, pairKeys[3], caraId, deeId, 'PENDING', null, 0);
    const deeToBob = await createTrackedRequest(dee, bobId, runManifestPath, runManifest);
    assert.equal(deeToBob.status, 201);
    await assertCanonicalPair(driver, pairKeys[4], bobId, deeId, 'PENDING', null, 0);

    const beforeReadOnlyGets = await readFixtureSnapshot(driver, pairKeys);
    const receivedPageOne = await cara.agent.get('/friendships/requests')
      .query({ direction: 'received', limit: 1 }).expect(200);
    assert.equal(receivedPageOne.body.items.length, 1);
    assert.equal(receivedPageOne.body.pagination.hasMore, true);
    assert.equal(typeof receivedPageOne.body.pagination.nextCursor, 'string');
    const receivedPageTwo = await cara.agent.get('/friendships/requests')
      .query({ direction: 'received', limit: 1, cursor: receivedPageOne.body.pagination.nextCursor }).expect(200);
    assert.equal(receivedPageTwo.body.items.length, 1);
    assert.equal(receivedPageTwo.body.pagination.hasMore, false);
    assert.deepEqual(
      [receivedPageOne.body.items[0].request.senderId, receivedPageTwo.body.items[0].request.senderId].sort(),
      [aliceId, deeId].sort(),
    );
    assert.equal(receivedPageOne.body.pagination.limit, 1);

    const sentPageOne = await dee.agent.get('/friendships/requests')
      .query({ direction: 'sent', limit: 1 }).expect(200);
    assert.equal(sentPageOne.body.items.length, 1);
    assert.equal(sentPageOne.body.pagination.hasMore, true);
    const sentPageTwo = await dee.agent.get('/friendships/requests')
      .query({ direction: 'sent', limit: 1, cursor: sentPageOne.body.pagination.nextCursor }).expect(200);
    assert.equal(sentPageTwo.body.items.length, 1);
    assert.equal(sentPageTwo.body.pagination.hasMore, false);
    assert.deepEqual(
      [sentPageOne.body.items[0].request.recipientId, sentPageTwo.body.items[0].request.recipientId].sort(),
      [bobId, caraId].sort(),
    );
    await dee.agent.get('/friendships/requests').query({
      direction: 'received', limit: 1, cursor: sentPageOne.body.pagination.nextCursor,
    }).expect(422);
    await bob.agent.get('/friendships/requests').query({
      direction: 'sent', limit: 1, cursor: sentPageOne.body.pagination.nextCursor,
    }).expect(422);
    assert.deepEqual(await readFixtureSnapshot(driver, pairKeys), beforeReadOnlyGets,
      'Received/sent request pages and invalid request cursors must not mutate fixture graph state');

    const aliceToDee = await createTrackedRequest(alice, deeId, runManifestPath, runManifest);
    assert.equal(aliceToDee.status, 201);
    const deeAcceptsAlice = await post(dee, `/friendships/requests/${aliceToDee.body.request.id}/accept`, {});
    assert.equal(deeAcceptsAlice.status, 200);
    const aliceDeeFriendshipId = deeAcceptsAlice.body.relationship.friendshipId;
    await recordRunFriendship(runManifestPath, runManifest, pairKeys[2], aliceDeeFriendshipId);
    await assertCanonicalPair(driver, pairKeys[2], aliceId, deeId, 'ACCEPTED', aliceDeeFriendshipId, 1);
    await assertWholeGraph(driver);

    const beforeFriendsGets = await readFixtureSnapshot(driver, pairKeys);
    const friendsPageOne = await alice.agent.get('/friendships').query({ limit: 1 }).expect(200);
    assert.equal(friendsPageOne.body.items.length, 1);
    assert.equal(friendsPageOne.body.pagination.hasMore, true);
    assert.equal(typeof friendsPageOne.body.pagination.nextCursor, 'string');
    const friendsPageTwo = await alice.agent.get('/friendships')
      .query({ limit: 1, cursor: friendsPageOne.body.pagination.nextCursor }).expect(200);
    assert.equal(friendsPageTwo.body.items.length, 1);
    assert.equal(friendsPageTwo.body.pagination.hasMore, false);
    assert.deepEqual(
      [friendsPageOne.body.items[0].member.id, friendsPageTwo.body.items[0].member.id].sort(),
      [bobId, deeId].sort(),
    );
    const defaultFriends = await alice.agent.get('/friendships').expect(200);
    assert.equal(defaultFriends.body.pagination.limit, 20);
    const defaultSent = await dee.agent.get('/friendships/requests').query({ direction: 'sent' }).expect(200);
    assert.equal(defaultSent.body.pagination.limit, 20);
    const maxFriends = await alice.agent.get('/friendships').query({ limit: 50 }).expect(200);
    assert.equal(maxFriends.body.pagination.limit, 50);
    assert.ok(maxFriends.body.items.length <= 50);
    await alice.agent.get('/friendships').query({ limit: 51 }).expect(422);
    const maxRequests = await dee.agent.get('/friendships/requests').query({ direction: 'sent', limit: 50 }).expect(200);
    assert.equal(maxRequests.body.pagination.limit, 50);
    await dee.agent.get('/friendships/requests').query({ direction: 'sent', limit: 0 }).expect(422);
    await dee.agent.get('/friendships/requests').query({ direction: 'sent', limit: 51 }).expect(422);

    await alice.agent.get('/friendships').query({ limit: 1, cursor: 'not-a-cursor' }).expect(422);
    await cara.agent.get('/friendships/requests')
      .query({ direction: 'received', limit: 1, cursor: 'not-a-cursor' }).expect(422);
    await alice.agent.get('/friendships/requests').query({
      direction: 'received', limit: 1, cursor: friendsPageOne.body.pagination.nextCursor,
    }).expect(422);
    await cara.agent.get('/friendships/requests').query({
      direction: 'sent', limit: 1, cursor: receivedPageOne.body.pagination.nextCursor,
    }).expect(422);
    await alice.agent.get('/friendships/requests').query({
      direction: 'received', limit: 1, cursor: sentPageOne.body.pagination.nextCursor,
    }).expect(422);
    await alice.agent.get('/friendships').query({ limit: 0 }).expect(422);
    assert.equal((await status(alice, caraId)).body.relationship.state, 'outgoing_pending');
    assert.equal((await status(cara, deeId)).body.relationship.state, 'incoming_pending');
    assert.deepEqual(await readFixtureSnapshot(driver, pairKeys), beforeFriendsGets,
      'Friends pages, defaults, limits, status reads and cursor errors must not mutate fixture graph state');

    const concurrentUnfriendRace = await withActualTransactionOverlap(appNeo4jService, () => Promise.all([
      alice.agent.delete(`/friendships/${secondFriendshipId}`)
        .set('Origin', origin).set('X-CSRF-Token', alice.csrfToken),
      bob.agent.delete(`/friendships/${secondFriendshipId}`)
        .set('Origin', origin).set('X-CSRF-Token', bob.csrfToken),
    ]));
    const concurrentUnfriend = concurrentUnfriendRace.value;
    assert.ok(concurrentUnfriendRace.enteredCallbacks >= 2);
    assert.ok(concurrentUnfriendRace.distinctTransactions >= 2);
    assert.deepEqual(concurrentUnfriend.map((result) => result.status), [204, 204]);
    assert.equal((await status(alice, bobId)).body.relationship.state, 'none');
    await assertCanonicalPair(driver, pairKeys[0], aliceId, bobId, 'ACCEPTED', null, 0);
    await assertWholeGraph(driver);

    const readLimitResults = [];
    for (let index = 0; index < 121; index += 1) readLimitResults.push(await limitActor.agent.get('/friendships'));
    assert.deepEqual(readLimitResults.slice(0, 120).map((result) => result.status), Array(120).fill(200));
    assert.equal(readLimitResults[120]?.status, 429);
    assert.equal(readLimitResults[120]?.body.error.code, 'RATE_LIMITED');
    assert.match(readLimitResults[120]?.headers['retry-after'] ?? '', /^[1-9]\d*$/u);
    assert.equal(readLimitResults[120]?.headers['cache-control'], 'no-store');

    const writeLimitResults = [];
    for (let index = 0; index < 21; index += 1) {
      writeLimitResults.push(await post(limitActor, '/friendships/requests', { recipientId: randomUUID() }));
    }
    assert.deepEqual(writeLimitResults.slice(0, 20).map((result) => result.status), Array(20).fill(404));
    assert.equal(writeLimitResults[20]?.status, 429);
    assert.equal(writeLimitResults[20]?.body.error.code, 'RATE_LIMITED');
    assert.match(writeLimitResults[20]?.headers['retry-after'] ?? '', /^[1-9]\d*$/u);
    assert.equal(writeLimitResults[20]?.headers['cache-control'], 'no-store');
    await assertWholeGraph(driver);

    console.log(JSON.stringify({
      scenario: 'ISN-A-friendship-lifecycle-concurrency',
      database: 'isn-test',
      principal: 'isn_test_runner',
      rolesVerified: true,
      devAccess: 'denied',
      schemaVersion: 4,
      sameDirectionRace: 'one-created-one-conflict',
      managedWriteTransactionOverlap: [
        'same-direction-request', 'opposite-direction-request', 'duplicate-accept',
        'accept-cancel', 'accept-reject', 'concurrent-unfriend',
      ].map((scenario) => `${scenario}:two-distinct-callbacks-entered-before-release`),
      raceOutcomes: 'asserted-separately-after-overlap-barrier-release',
      oppositeDirectionRace: 'one-created-one-conflict-no-auto-accept',
      duplicateAcceptRace: 'one-canonical-edge-idempotent-retry',
      acceptCancelAndAcceptRejectRaces: 'single-terminal-state-no-mixed-graph',
      concurrentUnfriend: 'both-204-one-edge-removed',
      failedAccept: 'transaction-rollback-preserved-pending-pair-and-existing-friendship',
      staleIdentifiers: 'rejected-without-current-lifecycle-mutation',
      fixtureUsers: userIds.length,
    }));
  } finally {
    try {
      if (app) await app.close();
    } finally {
      try {
        if (targetVerified && runManifestPath && runManifest) {
          const after = await cleanupRun(driver, runManifestPath, runManifest, preservationBaseline);
          assert.deepEqual(after.counts, {
            users: baseline.users, sessions: baseline.sessions, authEvents: baseline.events,
            pairs: baseline.pairs, friendships: baseline.friendships,
          });
        }
      } finally {
        if (authKeyDirectory) await rm(authKeyDirectory, { recursive: true, force: true });
        for (const [key, value] of previousAuthEnvironment) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await driver.close();
      }
    }
  }
});

async function createTrackedRequest(actor, recipientId, manifestPath, manifest) {
  const response = await post(actor, '/friendships/requests', { recipientId });
  if (response.status === 201) {
    await recordRunRequest(manifestPath, manifest, canonicalKey(actor.userId, recipientId), response.body.request.id);
  }
  return response;
}

async function post(actor, path, body) {
  return actor.agent.post(path)
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrfToken)
    .send(body);
}

async function status(actor, memberId) {
  return actor.agent.get(`/friendships/status/${memberId}`).expect(200);
}

async function assertWholeGraph(driver) {
  const session = driver.session({ database: 'isn-test' });
  try {
    await assertGraphInvariants(session);
  } finally {
    await session.close();
  }
}

async function withActualTransactionOverlap(service, operation) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(service, 'executeWrite');
  const originalExecuteWrite = service.executeWrite;
  let releaseBarrier;
  let resolveEntered;
  const callbacks = [];
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const entered = new Promise((resolve) => { resolveEntered = resolve; });
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Two managed write callbacks did not overlap within 15 seconds.')), 15_000);
  });
  service.executeWrite = function (work) {
    return originalExecuteWrite.call(this, async (transaction) => {
      callbacks.push(transaction);
      if (callbacks.length >= 2) resolveEntered();
      await barrier;
      return work(transaction);
    });
  };
  const operationPromise = operation();
  try {
    await Promise.race([
      entered,
      timeout,
      operationPromise.then(() => {
        throw new Error('The race completed before two managed write callbacks overlapped.');
      }),
    ]);
    const distinctTransactions = new Set(callbacks).size;
    assert.ok(callbacks.length >= 2);
    assert.ok(distinctTransactions >= 2, 'The barrier must be entered by two distinct managed transaction objects');
    releaseBarrier();
    const value = await operationPromise;
    return { value, enteredCallbacks: callbacks.length, distinctTransactions };
  } finally {
    releaseBarrier();
    clearTimeout(timeoutHandle);
    if (originalDescriptor) Object.defineProperty(service, 'executeWrite', originalDescriptor);
    else delete service.executeWrite;
  }
}

async function readPairState(driver, pairKey) {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (pair:FriendshipPair {pairKey: $pairKey})
       RETURN pair.version AS version, pair.requestId AS requestId, pair.senderId AS senderId,
              pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
              pair.friendshipId AS friendshipId, pair.lowUserId AS lowUserId,
              pair.highUserId AS highUserId`,
      { pairKey },
    );
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    return Object.fromEntries(['version', 'requestId', 'senderId', 'recipientId', 'requestStatus', 'friendshipId', 'lowUserId', 'highUserId']
      .map((key) => [key, record.get(key)]));
  } finally {
    await session.close();
  }
}

async function assertCanonicalPair(driver, pairKey, firstId, secondId, requestStatus, friendshipId, expectedEdges) {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (pair:FriendshipPair {pairKey: $pairKey})
       OPTIONAL MATCH (low:User)-[friendship:FRIEND_WITH {pairKey: $pairKey}]->(high:User)
       RETURN pair.pairKey AS pairKey, pair.lowUserId AS lowUserId, pair.highUserId AS highUserId,
              pair.requestStatus AS requestStatus, pair.friendshipId AS friendshipId,
              count(friendship) AS edges, collect(friendship.id) AS friendshipIds,
              collect(low.id) AS lowIds, collect(high.id) AS highIds`,
      { pairKey },
    );
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    const expectedLow = firstId < secondId ? firstId : secondId;
    const expectedHigh = firstId < secondId ? secondId : firstId;
    assert.equal(record.get('pairKey'), pairKey);
    assert.equal(record.get('lowUserId'), expectedLow);
    assert.equal(record.get('highUserId'), expectedHigh);
    assert.equal(record.get('requestStatus'), requestStatus);
    assert.equal(asNumber(record.get('edges')), expectedEdges);
    if (expectedEdges) {
      assert.equal(record.get('friendshipId'), friendshipId);
      assert.deepEqual(record.get('friendshipIds'), [friendshipId]);
      assert.deepEqual(record.get('lowIds'), [expectedLow]);
      assert.deepEqual(record.get('highIds'), [expectedHigh]);
    } else {
      assert.equal(record.get('friendshipId'), null);
      assert.deepEqual(record.get('friendshipIds'), []);
    }
  } finally {
    await session.close();
  }
}

function canonicalKey(first, second) {
  const low = first < second ? first : second;
  const high = first < second ? second : first;
  return `${low}:${high}`;
}

async function readCounts(session) {
  const result = await session.run(
    `CALL { MATCH (user:User) RETURN count(user) AS users }
     CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
     CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
     CALL { MATCH (pair:FriendshipPair) RETURN count(pair) AS pairs }
     CALL { MATCH ()-[friendship:FRIEND_WITH]-() RETURN count(friendship) AS friendships }
     RETURN users, sessions, events, pairs, friendships`,
  );
  const record = result.records[0];
  assert.ok(record);
  return Object.fromEntries(['users', 'sessions', 'events', 'pairs', 'friendships']
    .map((key) => [key, asNumber(record.get(key))]));
}

async function readFixtureSnapshot(driver, pairKeys) {
  const session = driver.session({ database: 'isn-test' });
  try {
    const counts = await readCounts(session);
    const pairs = await session.run(
      `MATCH (pair:FriendshipPair) WHERE pair.pairKey IN $pairKeys
       RETURN pair.pairKey AS pairKey, pair.version AS version,
              pair.requestId AS requestId, pair.senderId AS senderId,
              pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
              pair.friendshipId AS friendshipId, toString(pair.requestedAt) AS requestedAt,
              toString(pair.resolvedAt) AS resolvedAt, toString(pair.friendsSince) AS friendsSince
       ORDER BY pair.pairKey`,
      { pairKeys },
    );
    const friendships = await session.run(
      `MATCH (low:User)-[friendship:FRIEND_WITH]->(high:User)
       WHERE friendship.pairKey IN $pairKeys
       RETURN friendship.id AS id, friendship.pairKey AS pairKey,
              low.id AS lowUserId, high.id AS highUserId, toString(friendship.since) AS since
       ORDER BY friendship.pairKey, friendship.id`,
      { pairKeys },
    );
    return {
      counts,
      pairs: pairs.records.map((record) => ({
        pairKey: record.get('pairKey'),
        version: asNumber(record.get('version')),
        requestId: record.get('requestId'),
        senderId: record.get('senderId'),
        recipientId: record.get('recipientId'),
        requestStatus: record.get('requestStatus'),
        friendshipId: record.get('friendshipId'),
        requestedAt: record.get('requestedAt'),
        resolvedAt: record.get('resolvedAt'),
        friendsSince: record.get('friendsSince'),
      })),
      friendships: friendships.records.map((record) => ({
        id: record.get('id'),
        pairKey: record.get('pairKey'),
        lowUserId: record.get('lowUserId'),
        highUserId: record.get('highUserId'),
        since: record.get('since'),
      })),
    };
  } finally {
    await session.close();
  }
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
