import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import request from 'supertest';
import neo4j from 'neo4j-driver';
import friendshipSupport from '../../fixtures/friendships/acceptance-support.cjs';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';
import {
  capturePostsDataFingerprint,
  createPostsRunManifest,
  recordPostsAuthState,
  recordPostsFriendshipState,
  recordPostsPost,
  removePostsRunManifest,
  reservePostsFriendship,
  reservePostsPostIntent,
  reservePostsUser,
  savePostsRunManifest,
  validatePostsRunManifest,
} from '../../fixtures/posts/acceptance-support.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const origin = 'http://127.0.0.1:3000';
const migrationHistory = [
  [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
  [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
  [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
  [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2'],
];
const password = 'synthetic posts integration password';

test('real Posts & Feed behavior is isolated, version-safe, friendship-aware, and fully recoverable', async () => {
  assertWriteWindowEnvironment();
  await assertNoUnresolvedManifests();
  const testDriver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const admin = await readAdminSettings();
  const adminDriver = neo4j.driver(admin.uri, neo4j.auth.basic(admin.username, admin.password));
  const authEnvironmentKeys = [
    'AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH',
    'AUTH_KEY_ID', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_WEB_ORIGIN',
  ];
  const previousAuthEnvironment = new Map(authEnvironmentKeys.map((key) => [key, process.env[key]]));
  const actors = new Map();
  const userIds = Array.from({ length: 9 }, () => randomUUID()).sort();
  const emails = userIds.map((id) => `profile-${id}@example.invalid`);
  const markerBase = `posts-fixture-${randomUUID().replaceAll('-', '')}`;
  const accounts = userIds.map((id, index) => ({
    id,
    email: emails[index],
    registrationEventId: randomUUID(),
  }));
  const ownerIndex = 5;
  const ownerId = userIds[ownerIndex];
  assert.ok(ownerId);
  const lowFriends = accounts.slice(0, 2);
  const outsider = accounts[2];
  const pendingFriend = accounts[3];
  const rejectedFriend = accounts[4];
  const highFriends = accounts.slice(6, 8);
  const cancelledFriend = accounts[8];
  assert.ok(outsider && pendingFriend && rejectedFriend && cancelledFriend);
  const acceptedFriends = [...lowFriends, ...highFriends];
  const pairKeys = new Map();
  const friendIds = new Map();
  let app;
  let appModule;
  let authKeyDirectory;
  let runManifest;
  let runManifestPath;
  let baseline;
  let identityVerified = false;
  let testSession;
  let adminDataSession;
  let adminSystemSession;
  let appPostsRepository;
  let appFriendshipsRepository;
  let appNeo4j;

  try {
    await assertV5Preflight({ testDriver, adminDriver, admin });
    const baselineFile = JSON.parse(await readFile(
      resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json'), 'utf8',
    ));
    const snapshot = await withSession(testDriver, (session) => capturePostsDataFingerprint(session));
    baseline = { dataFingerprint: snapshot.dataFingerprint, counts: snapshot.counts };
    assert.deepEqual(baseline, {
      dataFingerprint: baselineFile.dataFingerprint,
      counts: baselineFile.counts,
    }, 'The approved pre-V5 preservation baseline changed; no fixture writes were made.');
    testSession = testDriver.session({ database: 'isn-test' });
    adminDataSession = adminDriver.session({ database: 'isn-test' });
    adminSystemSession = adminDriver.session({ database: 'system' });
    const idConflicts = await testSession.run(
      'MATCH (user:User) WHERE user.id IN $ids OR user.email IN $emails RETURN count(user) AS count',
      { ids: userIds, emails },
    );
    assert.equal(asNumber(idConflicts.records[0]?.get('count')), 0);
    identityVerified = true;

    ({ path: runManifestPath, manifest: runManifest } = await createPostsRunManifest({
      databaseId: friendshipSupport.DATABASE_ID,
      baseline,
    }));
    for (const account of accounts) {
      reservePostsUser(runManifest, account);
    }
    await savePostsRunManifest(runManifestPath, runManifest);

    await mkdir(resolve(root, '.artifacts'), { recursive: true });
    authKeyDirectory = await mkdtemp(resolve(root, '.artifacts/neo4j-posts-keys-'));
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
      AUTH_KEY_ID: 'neo4j-posts-integration',
      AUTH_ISSUER: origin,
      AUTH_AUDIENCE: 'intelligent-social-network-web',
      AUTH_WEB_ORIGIN: origin,
    });

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../../apps/api/dist/app.module.js');
    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { AuthSecurityService } = await import('../../../apps/api/dist/modules/auth/auth-security.service.js');
    const { configureAuthHttp } = await import('../../../apps/api/dist/modules/auth/auth-http.js');
    const { FriendshipsRepository } = await import('../../../apps/api/dist/modules/friendships/friendships.repository.js');
    const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
    const { PostGraphInvariantError } = await import('../../../apps/api/dist/modules/posts/posts.errors.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    appModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = appModule.createNestApplication();
    configureAuthHttp(app, appModule.get(AuthSecurityService), origin);
    await app.init();
    appNeo4j = appModule.get(Neo4jService);
    appPostsRepository = appModule.get(PostsRepository);
    appFriendshipsRepository = appModule.get(FriendshipsRepository);
    const ready = await request(app.getHttpServer()).get('/ready').expect(200);
    assert.equal(ready.body.database, 'isn-test');
    assert.equal(ready.body.schemaVersion, 5);

    const authRepository = new AuthRepository(appNeo4j);
    const passwordHash = await new PasswordService().hash(password);
    for (const account of accounts) {
      await authRepository.register({
        id: account.id,
        email: account.email,
        passwordHash,
        eventId: account.registrationEventId,
        now: new Date().toISOString(),
      });
      await refreshOwnedAuthState(testSession, runManifest, runManifestPath, account.id);
    }
    for (const account of accounts) {
      const agent = request.agent(app.getHttpServer());
      const bootstrap = await agent.get('/auth/csrf').expect(200);
      const login = await agent.post('/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: account.email, password })
        .expect(200);
      assert.equal(login.body.user.id, account.id);
      const csrf = await agent.get('/auth/csrf').expect(200);
      actors.set(account.id, { agent, csrfToken: csrf.body.csrfToken, userId: account.id });
      await refreshOwnedAuthState(testSession, runManifest, runManifestPath, account.id);
    }

    await createFriendshipState({
      manifest: runManifest, manifestPath: runManifestPath, repository: appFriendshipsRepository,
      session: testSession, ownerId,
      actorId: ownerId, otherId: outsider.id, status: 'PENDING', key: 'pending', pairKeys, friendIds,
    });
    await createFriendshipState({
      manifest: runManifest, manifestPath: runManifestPath, repository: appFriendshipsRepository,
      session: testSession, ownerId,
      actorId: ownerId, otherId: pendingFriend.id, status: 'PENDING', key: 'pending-visible', pairKeys, friendIds,
    });
    await createFriendshipState({
      manifest: runManifest, manifestPath: runManifestPath, repository: appFriendshipsRepository,
      session: testSession, ownerId,
      actorId: ownerId, otherId: rejectedFriend.id, status: 'REJECTED', key: 'rejected', pairKeys, friendIds,
    });
    await createFriendshipState({
      manifest: runManifest, manifestPath: runManifestPath, repository: appFriendshipsRepository,
      session: testSession, ownerId,
      actorId: ownerId, otherId: cancelledFriend.id, status: 'CANCELLED', key: 'cancelled', pairKeys, friendIds,
    });
    for (let index = 0; index < acceptedFriends.length; index += 1) {
      const friend = acceptedFriends[index];
      assert.ok(friend);
      await createFriendshipState({
        manifest: runManifest, manifestPath: runManifestPath, repository: appFriendshipsRepository,
        session: testSession, ownerId,
        actorId: ownerId, otherId: friend.id, status: 'ACCEPTED', key: `accepted-${index}`, pairKeys, friendIds,
      });
    }

    const ownerActor = actors.get(ownerId);
    const outsiderActor = actors.get(outsider.id);
    const pendingActor = actors.get(pendingFriend.id);
    assert.ok(ownerActor && outsiderActor && pendingActor);
    const apiCreated = await createApiPost({
      actor: ownerActor, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-api`, visibility: 'friends',
      content: `Xin chào Việt Nam 🌱 ${markerBase}-api`,
    });
    assert.equal(apiCreated.post.permissions.canEdit, true);

    const ownerMember = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-owner-member`, visibility: 'members',
      createdAt: '2026-10-15T10:00:00.000Z',
    });
    const ownerFriends = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-owner-friends`, visibility: 'friends',
      createdAt: '2026-10-15T10:01:00.000Z',
    });
    const acceptedVisible = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: acceptedFriends[0].id, marker: `${markerBase}-friend-visible`, visibility: 'friends',
      createdAt: '2026-10-15T10:02:00.000Z',
    });
    const acceptedMember = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: acceptedFriends[1].id, marker: `${markerBase}-friend-members`, visibility: 'members',
      createdAt: '2026-10-15T10:03:00.000Z',
    });
    const acceptedHigherVisible = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: acceptedFriends[2].id, marker: `${markerBase}-higher-friend-visible`, visibility: 'friends',
      createdAt: '2026-10-15T10:03:30.000Z',
    });
    const outsiderMember = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: outsider.id, marker: `${markerBase}-outsider-member`, visibility: 'members',
      createdAt: '2026-10-15T10:04:00.000Z',
    });
    const outsiderPrivate = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: outsider.id, marker: `${markerBase}-outsider-private`, visibility: 'friends',
      createdAt: '2026-10-15T10:05:00.000Z',
    });
    const pendingPrivate = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: pendingFriend.id, marker: `${markerBase}-pending-private`, visibility: 'friends',
      createdAt: '2026-10-15T10:06:00.000Z',
    });
    const rejectedPrivate = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: rejectedFriend.id, marker: `${markerBase}-rejected-private`, visibility: 'friends',
      createdAt: '2026-10-15T10:07:00.000Z',
    });
    const cancelledPrivate = await createRepositoryPost({
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      authorId: cancelledFriend.id, marker: `${markerBase}-cancelled-private`, visibility: 'friends',
      createdAt: '2026-10-15T10:08:00.000Z',
    });

    const ownDetail = await ownerActor.agent.get(`/posts/${apiCreated.post.id}`);
    assert.equal(ownDetail.status, 200, `Post detail failed with ${ownDetail.body?.error?.code ?? ownDetail.status}.`);
    assert.equal(ownDetail.body.post.author.id, ownerId);
    assert.deepEqual(ownDetail.body.post.permissions, { canEdit: true, canDelete: true });
    const bothDirections = await Promise.all([
      ownerActor.agent.get(`/posts/${acceptedVisible.id}`).expect(200),
      ownerActor.agent.get(`/posts/${acceptedMember.id}`).expect(200),
      ownerActor.agent.get(`/posts/${acceptedHigherVisible.id}`).expect(200),
    ]);
    assert.deepEqual(bothDirections.map((response) => response.body.post.author.id), [
      acceptedFriends[0].id,
      acceptedFriends[1].id,
      acceptedFriends[2].id,
    ]);
    assert.equal((await outsiderActor.agent.get(`/posts/${ownerMember.id}`).expect(200)).body.post.permissions.canEdit, false);
    await outsiderActor.agent.get(`/posts/${ownerFriends.id}`).expect(404);
    assert.equal((await outsiderActor.agent.get(`/posts/${ownerMember.id}`).expect(200)).body.post.id, ownerMember.id);
    assert.equal((await outsiderActor.agent.get(`/users/${ownerId}/posts`).expect(200)).body.items.some((post) => post.id === ownerMember.id), true);
    assert.equal((await outsiderActor.agent.get(`/users/${ownerId}/posts`).expect(200)).body.items.some((post) => post.id === ownerFriends.id), false);
    for (const post of [outsiderPrivate, pendingPrivate, rejectedPrivate, cancelledPrivate]) {
      await ownerActor.agent.get(`/posts/${post.id}`).expect(404);
      const page = await ownerActor.agent.get(`/users/${post.authorId}/posts`).expect(200);
      assert.equal(page.body.items.some((item) => item.id === post.id), false);
    }
    assert.equal((await ownerActor.agent.get('/feed').query({ limit: 50 }).expect(200)).body.items
      .some((post) => post.id === outsiderMember.id), false,
    'Member-visible posts from non-friends must not enter the viewer feed.');
    assert.equal((await pendingActor.agent.get(`/posts/${ownerMember.id}`).expect(200)).body.post.id, ownerMember.id);
    await pendingActor.agent.get(`/posts/${ownerFriends.id}`).expect(404);

    await assertStableCreationAndRollback({
      repository: appPostsRepository, session: testSession, PostGraphInvariantError,
      ownerId, otherAuthorId: outsider.id, post: apiCreated.post,
      marker: `${markerBase}-rollback`, manifest: runManifest, manifestPath: runManifestPath,
    });

    const profileLimit = await ownerActor.agent.get(`/users/${outsider.id}/posts`).query({ limit: 1 }).expect(200);
    assert.deepEqual(profileLimit.body.items.map((post) => post.id), [outsiderMember.id],
      'The hidden newest Post must be filtered before the profile page limit.');
    assert.equal(profileLimit.body.pagination.hasMore, false);

    const timestamp = '2026-10-15T11:00:00.000Z';
    const identicalTimestampPosts = await Promise.all(Array.from({ length: 3 }, (_, index) =>
      createRepositoryPost({
        repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
        authorId: ownerId, marker: `${markerBase}-tie-${index}`, visibility: 'members', createdAt: timestamp,
      }),
    ));
    const ownerProfile = await ownerActor.agent.get(`/users/${ownerId}/posts`).query({ limit: 50 }).expect(200);
    const positions = identicalTimestampPosts.map((post) => ownerProfile.body.items.findIndex((item) => item.id === post.id));
    assert.ok(positions.every((index) => index >= 0));
    assert.equal(positions.length, 3);
    const orderedTieIds = ownerProfile.body.items
      .filter((item) => identicalTimestampPosts.some((post) => post.id === item.id))
      .map((item) => item.id);
    assert.deepEqual(orderedTieIds, [...orderedTieIds].sort().reverse());

    await assertDenseFeedPagination({
      actor: ownerActor, repository: appPostsRepository, manifest: runManifest,
      manifestPath: runManifestPath, ownerId, friends: acceptedFriends, markerBase,
    });

    const ownerPosts = await ownerActor.agent.get(`/users/${ownerId}/posts`).query({ limit: 50 }).expect(200);
    const ownerPost = ownerPosts.body.items.find((post) => post.id === ownerMember.id);
    assert.ok(ownerPost);
    const protectedSnapshot = { content: ownerPost.content, version: ownerPost.version, updatedAt: ownerPost.updatedAt };
    const unauthorizedEdit = await outsiderActor.agent.patch(`/posts/${ownerMember.id}`)
      .set('Origin', origin).set('X-CSRF-Token', outsiderActor.csrfToken)
      .send({ content: 'غير مجاز', expectedVersion: 0 });
    assert.equal(unauthorizedEdit.status, 403);
    const unauthorizedDelete = await outsiderActor.agent.delete(`/posts/${ownerMember.id}?expectedVersion=0`)
      .set('Origin', origin).set('X-CSRF-Token', outsiderActor.csrfToken);
    assert.equal(unauthorizedDelete.status, 403);
    const protectedAfter = await ownerActor.agent.get(`/posts/${ownerMember.id}`).expect(200);
    assert.deepEqual({
      content: protectedAfter.body.post.content,
      version: protectedAfter.body.post.version,
      updatedAt: protectedAfter.body.post.updatedAt,
    }, protectedSnapshot, 'Unauthorized mutation attempts must not change the Post.');

    const editTarget = await createApiPost({
      actor: ownerActor, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-concurrent-edit`, visibility: 'members',
      content: `${markerBase}-concurrent-edit original`,
    });
    const concurrentEdits = await Promise.all([
      ownerActor.agent.patch(`/posts/${editTarget.post.id}`)
        .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
        .send({ content: `${markerBase}-winner-a`, expectedVersion: 0 }),
      ownerActor.agent.patch(`/posts/${editTarget.post.id}`)
        .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
        .send({ content: `${markerBase}-winner-b`, expectedVersion: 0 }),
    ]);
    assert.deepEqual(concurrentEdits.map((response) => response.status).sort(), [200, 409],
      `Concurrent edit outcomes: ${JSON.stringify(concurrentEdits.map((response) => ({
        status: response.status,
        code: response.body?.error?.code,
      })))}`);
    const editConflict = concurrentEdits.find((response) => response.status === 409);
    assert.equal(editConflict?.body.error.code, 'POST_CONFLICT');
    const edited = await ownerActor.agent.get(`/posts/${editTarget.post.id}`).expect(200);
    assert.equal(edited.body.post.version, 1);
    assert.ok(edited.body.post.content === `${markerBase}-winner-a` || edited.body.post.content === `${markerBase}-winner-b`);
    const staleEdit = await ownerActor.agent.patch(`/posts/${editTarget.post.id}`)
      .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
      .send({ content: 'Bản cũ', expectedVersion: 0 });
    assert.equal(staleEdit.status, 409);
    assert.equal((await ownerActor.agent.get(`/posts/${editTarget.post.id}`).expect(200)).body.post.version, 1);

    const editDeleteTarget = await createApiPost({
      actor: ownerActor, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-edit-delete`, visibility: 'members',
      content: `${markerBase}-edit-delete original`,
    });
    const editDeleteRace = await Promise.all([
      ownerActor.agent.patch(`/posts/${editDeleteTarget.post.id}`)
        .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
        .send({ content: `${markerBase}-race-edited`, expectedVersion: 0 }),
      ownerActor.agent.delete(`/posts/${editDeleteTarget.post.id}?expectedVersion=0`)
        .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken),
    ]);
    const raceEdit = editDeleteRace[0];
    const raceDelete = editDeleteRace[1];
    assert.ok(raceEdit && raceDelete);
    assert.ok([200, 404, 409].includes(raceEdit.status));
    assert.ok([204, 404, 409].includes(raceDelete.status));
    assert.equal(Number(raceEdit.status === 200) + Number(raceDelete.status === 204), 1,
      'Exactly one concurrent edit/delete operation must win.');
    if (raceDelete.status === 204) {
      await ownerActor.agent.get(`/posts/${editDeleteTarget.post.id}`).expect(404);
    } else {
      const retained = await ownerActor.agent.get(`/posts/${editDeleteTarget.post.id}`).expect(200);
      assert.equal(retained.body.post.version, 1);
    }

    await verifyCursorAnchorsAndFriendshipChanges({
      actor: ownerActor, ownerId, friend: acceptedFriends[0],
      repository: appPostsRepository, manifest: runManifest, manifestPath: runManifestPath,
      friendshipId: friendIds.get(acceptedFriends[0].id), pairKey: pairKeys.get(acceptedFriends[0].id),
      friendshipRepository: appFriendshipsRepository, session: testSession,
    });

    const feedResult = await ownerActor.agent.get('/feed').query({ limit: 50 }).expect(200);
    const visibleIds = new Set(feedResult.body.items.map((post) => post.id));
    assert.ok(visibleIds.has(ownerMember.id));
    assert.ok(visibleIds.has(acceptedVisible.id));
    assert.ok(visibleIds.has(acceptedHigherVisible.id));
    assert.equal(visibleIds.has(outsiderMember.id), false);
    assert.equal(visibleIds.has(outsiderPrivate.id), false);
    assert.equal(visibleIds.has(pendingPrivate.id), false);
    assert.equal(visibleIds.has(rejectedPrivate.id), false);
    assert.equal(visibleIds.has(cancelledPrivate.id), false);

    await captureActualFeedQueryPlan(testSession, ownerId);
    const guardedDelete = await createApiPost({
      actor: ownerActor, manifest: runManifest, manifestPath: runManifestPath,
      authorId: ownerId, marker: `${markerBase}-guarded-delete`, visibility: 'members',
      content: `${markerBase}-guarded-delete`,
    });
    await testSession.run(
      `MATCH (author:User {id:$authorId}), (post:Post {id:$postId})
       CREATE (author)-[:AUTHORED]->(post)`,
      { authorId: ownerId, postId: guardedDelete.post.id },
    );
    const failedDelete = await ownerActor.agent.delete(`/posts/${guardedDelete.post.id}?expectedVersion=0`)
      .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken);
    assert.equal(failedDelete.status, 503);
    assert.equal(failedDelete.body.error.code, 'POST_DATA_INCONSISTENT');
    const guardedState = await readPostOwnership(testSession, guardedDelete.post.id);
    assert.equal(guardedState.authorId, ownerId);
    assert.equal(guardedState.authoredLinks, 2);
    assert.equal(guardedState.relationships, 2);

    await assertGraphAndMigrationInvariants({
      testSession, adminDataSession, adminSystemSession, ownerId, guardedPostId: guardedDelete.post.id,
    });
    console.log(JSON.stringify({
      scenario: 'ISN-C-POSTS-REAL-NEO4J',
      database: 'isn-test',
      databaseId: friendshipSupport.DATABASE_ID,
      schemaVersion: 5,
      syntheticUsers: accounts.length,
      ownedPosts: runManifest.fixtures.posts.length,
      postVisibilityChecks: 'detail/profile/feed; member/friend/pending/rejected/cancelled',
      mutationChecks: 'owner/version/concurrent-edit/concurrent-edit-delete/atomic-rollback',
      queryPlan: 'captured from the production feed query',
    }));
  } finally {
    if (app) await app.close();
    let cleanupFailure;
    if (identityVerified && runManifest && runManifestPath) {
      try {
        await cleanupPostsRun({ driver: testDriver, manifest: runManifest, manifestPath: runManifestPath });
        await removePostsRunManifest(runManifestPath, runManifest);
      } catch (error) {
        cleanupFailure = error;
        console.error(JSON.stringify({
          scenario: 'ISN-C-POSTS-CLEANUP',
          status: 'INCOMPLETE',
          ownershipManifest: runManifestPath,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }));
      }
    }
    await Promise.all([
      testSession?.close(), adminDataSession?.close(), adminSystemSession?.close(),
      testDriver.close(), adminDriver.close(),
    ]);
    for (const key of authEnvironmentKeys) {
      const previous = previousAuthEnvironment.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    if (authKeyDirectory) await rm(authKeyDirectory, { recursive: true, force: true });
    if (cleanupFailure) throw cleanupFailure;
  }
});

async function assertV5Preflight({ testDriver, adminDriver, admin }) {
  const testSession = testDriver.session({ database: 'isn-test' });
  const system = adminDriver.session({ database: 'system' });
  const dev = testDriver.session({ database: 'isn-dev' });
  let neo4jService;
  try {
    await Promise.all([testDriver.verifyConnectivity(), adminDriver.verifyConnectivity()]);
    const identity = await testSession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const principal = await testSession.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.records[0]?.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    await assert.rejects(dev.run('CALL db.ping()'), (error) =>
      /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { Neo4jMigrationService, migrationDefinitions, checksumMigration } =
      await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    neo4jService = new Neo4jService(testDriver, 'isn-test');
    const status = await new Neo4jMigrationService(neo4jService).getStatus();
    assert.equal(status.status, 'current');
    assert.equal(status.version, 5);
    assert.deepEqual(status.migrations.map(({ version, name, checksum }) => [version, name, checksum]),
      migrationDefinitions.map((migration) => [migration.version, migration.name, checksumMigration(migration)]));
    assert.deepEqual(status.migrations.slice(0, 4).map(({ version, name, checksum }) => [version, name, checksum]), migrationHistory);
    assert.deepEqual(await new Neo4jMigrationService(neo4jService).migrate(), status,
      'Reapplying an already verified V5 migration must be a no-op.');
    const active = await system.run(
      `SHOW TRANSACTIONS YIELD database, transactionId
       WHERE database='isn-test' RETURN transactionId`,
    );
    assert.equal(active.records.length, 0, 'An active isn-test transaction blocks fixture writes.');
    await assertPostPrivileges(system, 'isn_test_runner');
    const components = await system.run('CALL dbms.components() YIELD versions,edition RETURN versions[0] AS version,edition');
    assert.equal(components.records[0]?.get('version'), '2026.09.0');
    assert.equal(components.records[0]?.get('edition'), 'enterprise');
  } finally {
    await Promise.all([testSession.close(), system.close(), dev.close()]);
  }
}

async function assertPostPrivileges(system, username) {
  const source = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
  const match = source.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
  assert.ok(match);
  const expected = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((item) => item[1]);
  const role = await system.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
  assert.deepEqual(role.records.map((record) => String(record.get('command'))).sort(), [...expected].sort());
  const publicRows = await system.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS');
  const publicPrivileges = publicRows.records.map((record) => String(record.get('command')));
  const effective = await system.run(`SHOW USER ${username} PRIVILEGES AS COMMANDS`);
  const expectedEffective = [...role.records.map((record) => String(record.get('command'))), ...publicPrivileges]
    .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'))
    .sort();
  assert.deepEqual(effective.records.map((record) => String(record.get('command'))).sort(), expectedEffective);
}

async function createFriendshipState({
  manifest,
  manifestPath,
  repository,
  session,
  ownerId,
  actorId,
  otherId,
  status,
  key,
  pairKeys,
  friendIds,
}) {
  const lowUserId = actorId < otherId ? actorId : otherId;
  const highUserId = actorId < otherId ? otherId : actorId;
  const pairKey = `${lowUserId}:${highUserId}`;
  const requestId = randomUUID();
  const requestedAt = new Date().toISOString();
  const resolvedAt = status === 'PENDING' ? null : new Date(Date.parse(requestedAt) + 1000).toISOString();
  reservePostsFriendship(manifest, {
    lowUserId,
    highUserId,
    requestId,
    requestStatus: 'PENDING',
    requestedAt,
  });
  await savePostsRunManifest(manifestPath, manifest);
  pairKeys.set(key, pairKey);
  pairKeys.set(otherId, pairKey);
  const created = await repository.createRequest({ senderId: actorId, recipientId: otherId, requestId, now: requestedAt });
  assert.equal(created.kind, 'success');
  if (status === 'PENDING') return;

  const friendshipId = status === 'ACCEPTED' ? randomUUID() : null;
  const friendsSince = status === 'ACCEPTED' ? new Date(Date.parse(requestedAt) + 2000).toISOString() : null;
  recordPostsFriendshipState(manifest, pairKey, {
    requestId,
    requestStatus: status,
    ...(friendshipId ? { friendshipId } : {}),
    ...(friendsSince ? { friendsSince } : {}),
    requestedAt,
    resolvedAt,
  });
  await savePostsRunManifest(manifestPath, manifest);
  const action = status === 'ACCEPTED' ? 'accept' : status === 'REJECTED' ? 'reject' : 'cancel';
  const actionActor = action === 'cancel' ? actorId : otherId;
  const result = await repository.actOnRequest({
    actorId: actionActor,
    requestId,
    action,
    friendshipId: friendshipId ?? randomUUID(),
    now: resolvedAt,
  });
  assert.equal(result.kind, 'success');
  if (friendshipId) {
    friendIds.set(otherId, friendshipId);
    assert.equal(result.result.relationship.friendshipId, friendshipId);
  }
  if (key.startsWith('accepted-')) pairKeys.set(otherId, pairKey);
  await savePostsRunManifest(manifestPath, manifest);
}

async function createApiPost({ actor, manifest, manifestPath, authorId, marker, visibility, content }) {
  reservePostsPostIntent(manifest, { authorId, marker, visibility });
  await savePostsRunManifest(manifestPath, manifest);
  const response = await actor.agent.post('/posts')
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrfToken)
    .send({ content, visibility });
  assert.equal(response.status, 201,
    `Post creation failed with ${response.body?.error?.code ?? response.status}.`);
  const post = response.body.post;
  recordPostsPost(manifest, { authorId, marker, postId: post.id });
  await savePostsRunManifest(manifestPath, manifest);
  return { post };
}

async function createRepositoryPost({ repository, manifest, manifestPath, authorId, marker, visibility, createdAt }) {
  reservePostsPostIntent(manifest, { authorId, marker, visibility });
  await savePostsRunManifest(manifestPath, manifest);
  const postId = randomUUID();
  const content = `Bài kiểm tra Việt Nam 🌿 ${marker}`;
  const post = await repository.create({ id: postId, authorId, content, visibility, createdAt });
  assert.ok(post);
  recordPostsPost(manifest, { authorId, marker, postId });
  await savePostsRunManifest(manifestPath, manifest);
  assert.equal(post.authorLinks, 1);
  assert.equal(post.authorCount, 1);
  assert.equal(post.relationshipCount, 1);
  return post;
}

async function assertStableCreationAndRollback({
  repository,
  session,
  PostGraphInvariantError,
  ownerId,
  otherAuthorId,
  post,
  marker,
  manifest,
  manifestPath,
}) {
  const original = await session.run(
    `MATCH (author:User {id:$authorId})-[edge:AUTHORED]->(post:Post {id:$postId})
     RETURN post.authorId AS authorId,post.content AS content,count(edge) AS edges`,
    { authorId: ownerId, postId: post.id },
  );
  assert.equal(original.records.length, 1);
  const row = original.records[0];
  const stableInput = {
    id: post.id,
    authorId: ownerId,
    content: String(row.get('content')),
    visibility: post.visibility,
    createdAt: post.createdAt,
  };
  await repository.create(stableInput);
  await repository.create(stableInput);
  const repeated = await readPostOwnership(session, post.id);
  assert.equal(repeated.authorId, ownerId);
  assert.equal(repeated.authoredLinks, 1, 'Replaying a stable transaction identity cannot duplicate AUTHORED edges.');
  assert.equal(repeated.relationships, 1);

  reservePostsPostIntent(manifest, { authorId: ownerId, marker, visibility: 'members' });
  await savePostsRunManifest(manifestPath, manifest);
  const rollbackId = randomUUID();
  const rollbackContent = `rollback ${marker}`;
  const rollback = await repository.create({
    id: rollbackId,
    authorId: ownerId,
    content: rollbackContent,
    visibility: 'members',
    createdAt: '2026-10-15T12:00:00.000Z',
  });
  assert.ok(rollback);
  recordPostsPost(manifest, { authorId: ownerId, marker, postId: rollbackId });
  await savePostsRunManifest(manifestPath, manifest);
  await assert.rejects(repository.create({
    id: rollbackId,
    authorId: otherAuthorId,
    content: `wrong owner ${marker}`,
    visibility: 'members',
    createdAt: '2026-10-15T12:00:01.000Z',
  }), PostGraphInvariantError);
  const afterRollback = await readPostOwnership(session, rollbackId);
  assert.equal(afterRollback.authorId, ownerId);
  assert.equal(afterRollback.authoredLinks, 1);
  assert.equal(afterRollback.relationships, 1);
}

async function assertDenseFeedPagination({ actor, repository, manifest, manifestPath, ownerId, friends, markerBase }) {
  const tieTime = '2099-10-15T13:00:00.000Z';
  const denseFriend = friends[0];
  const sparseFriend = friends[2];
  assert.ok(denseFriend && sparseFriend);
  const dense = [];
  for (let index = 0; index < 5; index += 1) {
    dense.push(await createRepositoryPost({
      repository, manifest, manifestPath, authorId: denseFriend.id,
      marker: `${markerBase}-dense-${index}`, visibility: 'friends',
      createdAt: new Date(Date.parse(tieTime) + index * 2000).toISOString(),
    }));
  }
  const sparse = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: sparseFriend.id,
    marker: `${markerBase}-sparse`, visibility: 'members',
    createdAt: new Date(Date.parse(tieTime) + 2500).toISOString(),
  });
  const ownerRecent = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: ownerId,
    marker: `${markerBase}-dense-owner`, visibility: 'members',
    createdAt: new Date(Date.parse(tieTime) + 1500).toISOString(),
  });
  const wholeSecond = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: sparseFriend.id,
    marker: `${markerBase}-whole-second`, visibility: 'members',
    createdAt: new Date(Date.parse(tieTime) + 7000).toISOString(),
  });
  const fractionalSecond = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: ownerId,
    marker: `${markerBase}-fractional-second`, visibility: 'members',
    createdAt: new Date(Date.parse(tieTime) + 7500).toISOString(),
  });
  const first = await actor.agent.get('/feed').query({ limit: 2 }).expect(200);
  assert.equal(first.body.items.length, 2);
  const visible = [...dense, sparse, ownerRecent, wholeSecond, fractionalSecond].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  assert.deepEqual(first.body.items.map((item) => item.id), visible.slice(0, 2).map((item) => item.id));
  assert.equal(first.body.items[1]?.id, fractionalSecond.id);
  const next = await actor.agent.get('/feed').query({ limit: 2, cursor: first.body.pagination.nextCursor }).expect(200);
  assert.equal(next.body.items[0]?.id, wholeSecond.id,
    'Fractional-second posts must sort ahead of whole-second posts across the page boundary.');
  assert.ok(first.body.items.some((item) => item.author.id === sparseFriend.id),
    'Dense Post authors must not starve other accepted friendship authors.');
  const paged = [...first.body.items];
  let cursor = first.body.pagination.nextCursor;
  while (cursor) {
    const page = await actor.agent.get('/feed').query({ limit: 2, cursor }).expect(200);
    paged.push(...page.body.items);
    cursor = page.body.pagination.nextCursor;
  }
  assert.equal(new Set(paged.map((item) => item.id)).size, paged.length);
  assert.ok(paged.some((item) => item.id === sparse.id));
}

async function verifyCursorAnchorsAndFriendshipChanges({
  actor,
  ownerId,
  friend,
  repository,
  manifest,
  manifestPath,
  friendshipId,
  pairKey,
  friendshipRepository,
  session,
}) {
  assert.ok(friendshipId && pairKey);
  const markerPrefix = `posts-fixture-${manifest.runId.replaceAll('-', '')}`;
  const anchor = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: ownerId,
    marker: `${markerPrefix}-cursor-anchor`, visibility: 'members',
    createdAt: '2099-10-15T20:00:00.000Z',
  });
  const nextVisible = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: friend.id,
    marker: `${markerPrefix}-cursor-next`, visibility: 'friends',
    createdAt: '2099-10-15T19:00:00.000Z',
  });
  const page = await actor.agent.get('/feed').query({ limit: 1 }).expect(200);
  assert.equal(page.body.items[0]?.id, anchor.id);
  const cursor = page.body.pagination.nextCursor;
  assert.equal(typeof cursor, 'string');
  await actor.agent.delete(`/posts/${anchor.id}?expectedVersion=0`)
    .set('Origin', origin).set('X-CSRF-Token', actor.csrfToken).expect(204);
  const afterDeletedAnchor = await actor.agent.get('/feed').query({ limit: 1, cursor }).expect(200);
  assert.notEqual(afterDeletedAnchor.body.items[0]?.id, anchor.id);
  assert.equal(afterDeletedAnchor.body.items[0]?.id, nextVisible.id);

  const changeAnchor = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: ownerId,
    marker: `${markerPrefix}-rel-anchor`, visibility: 'members',
    createdAt: '2100-10-15T22:00:00.000Z',
  });
  const removedFriendPost = await createRepositoryPost({
    repository, manifest, manifestPath, authorId: friend.id,
    marker: `${markerPrefix}-rel-friend`, visibility: 'friends',
    createdAt: '2100-10-15T21:00:00.000Z',
  });
  const beforeChange = await actor.agent.get('/feed').query({ limit: 1 }).expect(200);
  assert.equal(beforeChange.body.items[0]?.id, changeAnchor.id);
  const relationshipCursor = beforeChange.body.pagination.nextCursor;
  assert.equal(typeof relationshipCursor, 'string');
  await friendshipRepository.unfriend(ownerId, friendshipId);
  const unfriendState = await session.run(
    `MATCH (pair:FriendshipPair {pairKey:$pairKey})
     RETURN pair.lowUserId AS low,pair.highUserId AS high,pair.requestId AS requestId`,
    { pairKey },
  );
  assert.equal(unfriendState.records.length, 1);
  const tracked = manifest.fixtures.friendships.find((item) => item.pairKey === pairKey);
  assert.ok(tracked);
  recordPostsFriendshipState(manifest, pairKey, {
    requestId: String(unfriendState.records[0]?.get('requestId')),
    requestStatus: 'ACCEPTED',
    requestedAt: tracked.requestedAt,
    resolvedAt: tracked.resolvedAt,
  });
  await savePostsRunManifest(manifestPath, manifest);
  const afterUnfriend = await actor.agent.get('/feed').query({ limit: 50, cursor: relationshipCursor }).expect(200);
  assert.equal(afterUnfriend.body.items.some((item) => item.id === removedFriendPost.id), false,
    'Feed continuation must apply the current friendship state, not a stale friend set.');
  await actor.agent.get(`/posts/${removedFriendPost.id}`).expect(404);

  const requestId = randomUUID();
  const requestedAt = new Date().toISOString();
  recordPostsFriendshipState(manifest, pairKey, {
    requestId,
    requestStatus: 'PENDING',
    requestedAt,
  });
  await savePostsRunManifest(manifestPath, manifest);
  const requestResult = await friendshipRepository.createRequest({
    senderId: ownerId, recipientId: friend.id, requestId, now: requestedAt,
  });
  assert.equal(requestResult.kind, 'success');
  const refriendshipId = randomUUID();
  const friendsSince = new Date(Date.parse(requestedAt) + 1000).toISOString();
  const resolvedAt = new Date(Date.parse(requestedAt) + 1000).toISOString();
  recordPostsFriendshipState(manifest, pairKey, {
    requestId,
    requestStatus: 'ACCEPTED',
    friendshipId: refriendshipId,
    friendsSince,
    requestedAt,
    resolvedAt,
  });
  await savePostsRunManifest(manifestPath, manifest);
  const accepted = await friendshipRepository.actOnRequest({
    actorId: friend.id, requestId, action: 'accept', friendshipId: refriendshipId, now: resolvedAt,
  });
  assert.equal(accepted.kind, 'success');
  assert.equal(accepted.result.relationship.friendshipId, refriendshipId);
  const visibleAgain = await actor.agent.get(`/posts/${removedFriendPost.id}`).expect(200);
  assert.equal(visibleAgain.body.post.id, removedFriendPost.id);
}

async function captureActualFeedQueryPlan(session, viewerId) {
  const { postsFeedQuery } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
  const parameters = {
    viewerId,
    cursorCreatedAt: null,
    cursorId: null,
    perAuthorLimit: neo4j.int(21),
    fetchLimit: neo4j.int(21),
  };
  const explained = session.run(`EXPLAIN ${postsFeedQuery}`, parameters);
  const explainSummary = await explained.summary();
  const profiled = session.run(`PROFILE ${postsFeedQuery}`, parameters);
  const profileSummary = await profiled.summary();
  const operators = flattenPlan(profileSummary.profile ?? explainSummary.plan);
  const postIndex = operators.find((operator) => operator.postChronologyIndex && /NodeIndexSeek/u.test(operator.operatorType));
  const indexUsed = Boolean(postIndex);
  const dbHits = postIndex?.dbHits ?? Number.NaN;
  assert.ok(Number.isFinite(dbHits) && dbHits >= 0, 'PROFILE must return actual database-hit measurements.');
  assert.ok(indexUsed, `The production feed PROFILE must seek the Post chronology index: ${JSON.stringify(operators)}`);
  console.log(JSON.stringify({
    scenario: 'ISN-C-POSTS-FEED-QUERY-PLAN',
    database: 'isn-test',
    indexUsed,
    dbHits,
    rows: postIndex?.rows,
    operators,
  }));
}

async function assertGraphAndMigrationInvariants({
  testSession,
  adminDataSession,
  adminSystemSession,
  ownerId,
  guardedPostId,
}) {
  const duplicateOrOrphanPosts = await testSession.run(
    `MATCH (post:Post)
     CALL (post) {
       OPTIONAL MATCH (author:User)-[edge:AUTHORED]->(post)
       RETURN count(edge) AS edges, count(DISTINCT author) AS authors
     }
     WITH post, edges, authors
     WHERE post.authorId IS NULL OR edges <> 1 OR authors <> 1
     RETURN collect(post.id) AS invalidIds`,
  );
  assert.deepEqual(duplicateOrOrphanPosts.records[0]?.get('invalidIds'), [guardedPostId],
    'Only the deliberately corrupted test-owned Post may be inconsistent before exact cleanup.');
  const otherInvalidPosts = await testSession.run(
    `MATCH (post:Post)
     CALL (post) {
       OPTIONAL MATCH (author:User)-[edge:AUTHORED]->(post)
       RETURN collect(DISTINCT author.id) AS authorIds,count(edge) AS edges
     }
     WITH post, authorIds, edges
     WHERE post.id <> $guardedPostId AND
           (post.authorId IS NULL OR edges <> 1 OR size(authorIds) <> 1 OR head(authorIds) <> post.authorId)
     RETURN count(post) AS invalid`,
    { guardedPostId },
  );
  assert.equal(asNumber(otherInvalidPosts.records[0]?.get('invalid')), 0);
  await friendshipSupport.assertGraphInvariants(testSession);
  const status = await testSession.run(
    `MATCH (migration:ISNSchemaMigration)
     RETURN migration.version AS version,migration.name AS name,migration.checksum AS checksum,
            migration.status AS status,migration.appliedAt IS NOT NULL AS applied,
            migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
  );
  assert.deepEqual(status.records.slice(0, 4).map((record) => [
    asNumber(record.get('version')), record.get('name'), record.get('checksum'), record.get('status'),
    record.get('applied'), record.get('verified'),
  ]), migrationHistory.map(([version, name, checksum]) => [version, name, checksum, 'VERIFIED', true, true]));
  const v5 = status.records[4];
  assert.deepEqual([asNumber(v5?.get('version')), v5?.get('name'), v5?.get('status'), v5?.get('applied'), v5?.get('verified')],
    [5, 'posts-feed', 'VERIFIED', true, true]);
  const postSchema = await adminDataSession.run(
    `SHOW CONSTRAINTS YIELD name,type,entityType,labelsOrTypes,properties
     WHERE name='isn_post_id' RETURN name,type,entityType,labelsOrTypes,properties`,
  );
  assert.equal(postSchema.records[0]?.get('type'), 'NODE_PROPERTY_UNIQUENESS');
  assert.deepEqual(postSchema.records[0]?.get('labelsOrTypes'), ['Post']);
  assert.deepEqual(postSchema.records[0]?.get('properties'), ['id']);
  const postIndex = await adminDataSession.run(
    `SHOW INDEXES YIELD name,type,entityType,labelsOrTypes,properties,state
     WHERE name IN ['isn_post_id','isn_post_author_chronology']
     RETURN name,type,entityType,labelsOrTypes,properties,state ORDER BY name`,
  );
  assert.equal(postIndex.records.length, 2);
  assert.deepEqual(postIndex.records.map((record) => [
    record.get('name'), record.get('type'), record.get('entityType'), record.get('labelsOrTypes'),
    record.get('properties'), record.get('state'),
  ]), [
    ['isn_post_author_chronology', 'RANGE', 'NODE', ['Post'], ['authorId', 'createdAt', 'id'], 'ONLINE'],
    ['isn_post_id', 'RANGE', 'NODE', ['Post'], ['id'], 'ONLINE'],
  ]);
  const ownerRows = await testSession.run('MATCH (user:User {id:$ownerId}) RETURN user.id AS id', { ownerId });
  assert.equal(ownerRows.records.length, 1);
  const systemIdentity = await adminSystemSession.run('CALL dbms.showCurrentUser() YIELD username RETURN username');
  assert.ok(typeof systemIdentity.records[0]?.get('username') === 'string');
}

async function cleanupPostsRun({ driver, manifest, manifestPath }) {
  validatePostsRunManifest(manifest, friendshipSupport.DATABASE_ID);
  const session = driver.session({ database: 'isn-test' });
  try {
    const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), manifest.databaseId);

    for (const intent of manifest.fixtures.postIntents) {
      if (intent.postId !== null) continue;
      const candidates = await session.run(
        `MATCH (post:Post {authorId:$authorId})
         WHERE post.content CONTAINS $marker
         RETURN post.id AS id,post.content AS content`,
        { authorId: intent.authorId, marker: intent.marker },
      );
      assert.ok(candidates.records.length <= 1, 'An unresolved Post intent matched multiple records; preserve all evidence.');
      if (candidates.records[0]) {
        recordPostsPost(manifest, {
          authorId: intent.authorId,
          marker: intent.marker,
          postId: String(candidates.records[0].get('id')),
        });
        await savePostsRunManifest(manifestPath, manifest);
      }
    }

    for (const owned of manifest.fixtures.posts) {
      const current = await readOwnedPostForCleanup(session, owned);
      if (!current.exists) continue;
      assert.ok(current.authorIds.length >= 1 && current.authorIds.every((id) => id === owned.authorId));
      assert.equal(current.relationships, current.authoredLinks,
        'An unexpected non-AUTHORED relationship blocks exact Post cleanup.');
      assert.ok(current.authoredLinks <= 2, 'More than one fixture-introduced author edge requires manual review.');
      await session.executeWrite((tx) => tx.run(
        `MATCH (author:User {id:$authorId})-[edge:AUTHORED]->(post:Post {id:$postId,authorId:$authorId})
         WITH post,collect(edge) AS edges
         FOREACH (edge IN edges | DELETE edge)
         DELETE post`,
        { authorId: owned.authorId, postId: owned.postId },
      ));
      const remaining = await session.run('MATCH (post:Post {id:$postId}) RETURN count(post) AS count', { postId: owned.postId });
      assert.equal(asNumber(remaining.records[0]?.get('count')), 0);
    }
    manifest.cleanup.postsRemoved = true;
    await savePostsRunManifest(manifestPath, manifest);

    for (const pair of manifest.fixtures.friendships) {
      for (const friendshipId of pair.friendshipIds) {
        const edges = await session.run(
          `MATCH (low:User {id:$lowUserId})-[edge:FRIEND_WITH {id:$friendshipId,pairKey:$pairKey}]
                ->(high:User {id:$highUserId})
           RETURN edge.id AS id`,
          { lowUserId: pair.lowUserId, highUserId: pair.highUserId, friendshipId, pairKey: pair.pairKey },
        );
        assert.ok(edges.records.length <= 1);
        if (edges.records[0]) {
          await session.run(
            `MATCH (low:User {id:$lowUserId})-[edge:FRIEND_WITH {id:$friendshipId,pairKey:$pairKey}]
                  ->(high:User {id:$highUserId}) DELETE edge`,
            { lowUserId: pair.lowUserId, highUserId: pair.highUserId, friendshipId, pairKey: pair.pairKey },
          );
        }
      }
      const unknownEdges = await session.run(
        'MATCH ()-[edge:FRIEND_WITH {pairKey:$pairKey}]-() RETURN edge.id AS id',
        { pairKey: pair.pairKey },
      );
      assert.ok(unknownEdges.records.every((record) => pair.friendshipIds.includes(String(record.get('id'))) === false),
        'An unowned friendship edge blocks pair cleanup.');
      assert.equal(unknownEdges.records.length, 0);
      const pairNode = await session.run(
        `MATCH (pair:FriendshipPair {pairKey:$pairKey})
         RETURN pair.lowUserId AS low,pair.highUserId AS high,pair.requestId AS requestId`,
        { pairKey: pair.pairKey },
      );
      assert.ok(pairNode.records.length <= 1);
      if (pairNode.records[0]) {
        assert.equal(pairNode.records[0].get('low'), pair.lowUserId);
        assert.equal(pairNode.records[0].get('high'), pair.highUserId);
        assert.ok(pair.requestIds.includes(String(pairNode.records[0].get('requestId'))));
        await session.run(
          'MATCH (pair:FriendshipPair {pairKey:$pairKey,lowUserId:$lowUserId,highUserId:$highUserId}) DELETE pair',
          { pairKey: pair.pairKey, lowUserId: pair.lowUserId, highUserId: pair.highUserId },
        );
      }
      const pairRemaining = await session.run('MATCH (pair:FriendshipPair {pairKey:$pairKey}) RETURN count(pair) AS count', {
        pairKey: pair.pairKey,
      });
      assert.equal(asNumber(pairRemaining.records[0]?.get('count')), 0);
    }
    manifest.cleanup.friendshipsRemoved = true;
    await savePostsRunManifest(manifestPath, manifest);

    const { removeOwnedFixture } = await import('./fixture-ownership.mjs');
    for (const user of manifest.fixtures.users) {
      await removeOwnedFixture(session, user.email, user.userId);
    }
    manifest.cleanup.accountsRemoved = true;
    await savePostsRunManifest(manifestPath, manifest);
    const after = await capturePostsDataFingerprint(session);
    assert.deepEqual(after, manifest.baseline,
      'The preserved application graph fingerprint did not return exactly to its recorded baseline.');
    manifest.cleanup.baselineRestored = true;
    manifest.finishedAt = new Date().toISOString();
    await savePostsRunManifest(manifestPath, manifest);
  } finally {
    await session.close();
  }
}

async function readOwnedPostForCleanup(session, owned) {
  const post = await session.run('MATCH (post:Post {id:$postId}) RETURN post.authorId AS authorId', {
    postId: owned.postId,
  });
  if (!post.records[0]) return { exists: false };
  assert.equal(post.records.length, 1);
  assert.equal(post.records[0].get('authorId'), owned.authorId);
  const records = await session.run(
    `MATCH (post:Post {id:$postId})
     OPTIONAL MATCH (author)-[edge:AUTHORED]->(post)
     WITH post,collect(DISTINCT author.id) AS authorIds,count(edge) AS authoredLinks
     OPTIONAL MATCH (post)-[relationship]-()
     RETURN authorIds,authoredLinks,count(DISTINCT relationship) AS relationships`,
    { postId: owned.postId },
  );
  return {
    exists: true,
    authorIds: records.records[0]?.get('authorIds') ?? [],
    authoredLinks: asNumber(records.records[0]?.get('authoredLinks')),
    relationships: asNumber(records.records[0]?.get('relationships')),
  };
}

async function readPostOwnership(session, postId) {
  const result = await session.run(
    `MATCH (post:Post {id:$postId})
     OPTIONAL MATCH (author:User)-[edge:AUTHORED]->(post)
     WITH post,collect(DISTINCT author.id) AS authorIds,count(edge) AS authoredLinks
     OPTIONAL MATCH (post)-[relationship]-()
     RETURN post.authorId AS authorId,authorIds,authoredLinks,count(DISTINCT relationship) AS relationships`,
    { postId },
  );
  assert.equal(result.records.length, 1);
  const record = result.records[0];
  assert.ok(record);
  return {
    authorId: record.get('authorId'),
    authorIds: record.get('authorIds'),
    authoredLinks: asNumber(record.get('authoredLinks')),
    relationships: asNumber(record.get('relationships')),
  };
}

async function refreshOwnedAuthState(session, manifest, manifestPath, userId) {
  const result = await session.run(
    `MATCH (user:User {id:$userId})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(session:AuthSession)
     WITH user,collect(DISTINCT session.id) AS sessions
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN sessions,collect(DISTINCT event.eventId) AS events`,
    { userId },
  );
  assert.equal(result.records.length, 1);
  recordPostsAuthState(manifest, userId, {
    sessionIds: (result.records[0]?.get('sessions') ?? []).filter(Boolean),
    authEventIds: (result.records[0]?.get('events') ?? []).filter(Boolean),
  });
  await savePostsRunManifest(manifestPath, manifest);
}

async function assertNoUnresolvedManifests() {
  const directories = [
    resolve(root, '.artifacts/weylume/posts-acceptance'),
    resolve(root, '.artifacts/weylume/friendship-acceptance'),
    resolve(root, '.artifacts/weylume/profile-acceptance-recovery'),
    resolve(root, '.artifacts/weylume/auth-recovery'),
  ];
  for (const directory of directories) {
    let files = [];
    try { files = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.deepEqual(files.filter((file) => file.endsWith('.tmp') ||
      (file.endsWith('.json') && file !== 'v4-preservation-baseline.json')), [],
    `Unresolved recovery artifacts exist under ${directory}.`);
  }
}

function assertWriteWindowEnvironment() {
  assertPostsWriteWindow();
  const uri = new URL(process.env.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.port, '7687');
  assert.equal(normalizePath(process.cwd()), normalizePath(root));
  assert.equal(execGit(['branch', '--show-current']), 'feature/posts-feed');
  execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });
}

async function readAdminSettings() {
  const values = new Map();
  for (const line of (await readFile(resolve(root, 'apps/api/.env'), 'utf8')).split(/\r?\n/u)) {
    const match = line.match(/^\s*(NEO4J_URI|NEO4J_USERNAME|NEO4J_PASSWORD|NEO4J_DATABASE)\s*=\s*(.*?)\s*$/u);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\1$/u, '$2'));
  }
  const uri = values.get('NEO4J_URI');
  assert.ok(uri && values.get('NEO4J_USERNAME') && values.get('NEO4J_PASSWORD'));
  assert.equal(values.get('NEO4J_DATABASE'), 'isn-dev');
  assert.equal(uri, process.env.NEO4J_URI);
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'neo4j:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '7687');
  return { uri, username: values.get('NEO4J_USERNAME'), password: values.get('NEO4J_PASSWORD') };
}

async function withSession(driver, work) {
  const session = driver.session({ database: 'isn-test' });
  try { return await work(session); } finally { await session.close(); }
}

function flattenPlan(rootPlan) {
  const operators = [];
  const visit = (operator) => {
    if (!operator) return;
    const details = String(operator.arguments?.Details ?? '');
    operators.push({
      operatorType: String(operator.operatorType ?? 'unknown'),
      dbHits: asNumber(operator.dbHits ?? 0),
      rows: asNumber(operator.rows ?? 0),
      details,
      postChronologyIndex: details.includes('Post(authorId, createdAt, id)'),
    });
    for (const child of operator.children ?? []) visit(child);
  };
  visit(rootPlan);
  return operators;
}

function execGit(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
