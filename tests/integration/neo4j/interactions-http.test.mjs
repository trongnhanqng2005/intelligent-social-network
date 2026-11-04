import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import request from 'supertest';
import neo4j from 'neo4j-driver';
import friendshipSupport from '../../fixtures/friendships/acceptance-support.cjs';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';
import { removeOwnedFixture, recordFixtureOwnership, updateFixtureOwnership } from './fixture-ownership.mjs';
import { Neo4jMigrationService } from '../../../apps/api/dist/neo4j/neo4j-migrations.js';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const origin = 'http://127.0.0.1:3000';
const password = 'synthetic interactions integration password';

test('V6 interaction HTTP acceptance uses exact synthetic fixtures and restores them', async () => {
  assertPostsWriteWindow();
  assert.equal(resolve(process.cwd()), root);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/likes-comments');
  for (const scope of ['interactions-acceptance', 'profile-acceptance-recovery']) {
    const entries = await readdir(resolve(root, '.artifacts/weylume', scope)).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    assert.equal(entries.filter((entry) => /\.(?:json|tmp)$/u.test(entry)).length, 0,
      'Unresolved fixture manifests block a new interaction acceptance run.');
  }

  const uri = new URL(process.env.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.port, '7687');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');

  const driver = neo4j.driver(uri.toString(), neo4j.auth.basic(
    process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD,
  ));
  const session = driver.session({ database: 'isn-test' });
  const owner = { id: randomUUID(), email: `profile-${randomUUID()}@example.invalid` };
  const commenter = { id: randomUUID(), email: `profile-${randomUUID()}@example.invalid` };
  const marker = `interactions-${randomUUID()}`;
  const postIds = [randomUUID(), randomUUID()];
  const clientIds = [randomUUID(), randomUUID(), randomUUID()];
  const comments = [];
  const actors = new Map();
  const authKeys = [
    'AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH',
    'AUTH_KEY_ID', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_WEB_ORIGIN',
  ];
  const previousAuthEnvironment = new Map(authKeys.map((key) => [key, process.env[key]]));
  const ownershipPaths = new Map();
  let app;
  let appModule;
  let authKeyDirectory;
  let recoveryPath;
  let identityVerified = false;
  let fixturesStarted = false;
  let cleanupFailure;
  let postsRepository;

  try {
    await driver.verifyConnectivity();
    const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const principal = await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.records[0]?.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    identityVerified = true;

    const deniedDev = neo4j.driver(uri.toString(), neo4j.auth.basic(
      process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD,
    ));
    const devSession = deniedDev.session({ database: 'isn-dev' });
    try {
      await assert.rejects(devSession.run('RETURN 1'), /database|access|not authorized|permission/iu);
    } finally {
      await devSession.close();
      await deniedDev.close();
    }
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const migrationStatus = await new Neo4jMigrationService(new Neo4jService(driver, 'isn-test')).getStatus();
    assert.equal(migrationStatus.status, 'current');
    assert.equal(migrationStatus.version, 6);
    assert.equal(migrationStatus.migrations.at(-1)?.name, 'post-likes-comments');

    const conflict = await session.run(
      'MATCH (node) WHERE (node:User AND (node.id IN $ids OR node.email IN $emails)) OR (node:Post AND node.id IN $postIds) OR (node:Comment AND node.clientId IN $clientIds) RETURN count(node) AS count',
      { ids: [owner.id, commenter.id], emails: [owner.email, commenter.email], postIds, clientIds },
    );
    assert.equal(asNumber(conflict.records[0]?.get('count')), 0, 'Generated fixture identifiers must be unused.');
    const schema = await session.run(
      'MATCH (migration:ISNSchemaMigration {version:6,status:"VERIFIED"}) RETURN migration.name AS name',
    );
    assert.equal(schema.records[0]?.get('name'), 'post-likes-comments');

    await mkdir(resolve(root, '.artifacts/weylume/interactions-acceptance'), { recursive: true });
    for (const account of [owner, commenter]) {
      const path = await recordFixtureOwnership(account.email, account.id);
      ownershipPaths.set(account.id, path);
    }
    recoveryPath = resolve(root, `.artifacts/weylume/interactions-acceptance/${process.pid}-${randomUUID()}.json`);
    const recovery = {
      version: 1,
      scenario: 'ISN-C-INTERACTIONS-HTTP',
      database: 'isn-test',
      databaseId: friendshipSupport.DATABASE_ID,
      marker,
      users: [owner, commenter],
      postIds,
      clientIds,
      commentIds: comments,
    };
    await writeFile(recoveryPath, JSON.stringify(recovery), { flag: 'wx', mode: 0o600 });
    await mkdir(resolve(root, '.artifacts'), { recursive: true });
    authKeyDirectory = await mkdtemp(resolve(root, '.artifacts/neo4j-interactions-keys-'));
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
      AUTH_KEY_ID: 'neo4j-interactions-integration',
      AUTH_ISSUER: origin,
      AUTH_AUDIENCE: 'intelligent-social-network-web',
      AUTH_WEB_ORIGIN: origin,
    });

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../../apps/api/dist/app.module.js');
    const { configureAuthHttp } = await import('../../../apps/api/dist/modules/auth/auth-http.js');
    const { AuthSecurityService } = await import('../../../apps/api/dist/modules/auth/auth-security.service.js');
    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
    appModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = appModule.createNestApplication();
    configureAuthHttp(app, appModule.get(AuthSecurityService), origin);
    await app.listen(0, '127.0.0.1');
    const ready = await request(app.getHttpServer()).get('/ready').expect(200);
    assert.equal(ready.body.database, 'isn-test');
    assert.equal(ready.body.schemaVersion, 6);

    const neo4jService = appModule.get(Neo4jService);
    const authRepository = new AuthRepository(neo4jService);
    postsRepository = appModule.get(PostsRepository);
    const passwordHash = await new PasswordService().hash(password);
    fixturesStarted = true;
    for (const account of [owner, commenter]) {
      await authRepository.register({
        id: account.id,
        email: account.email,
        passwordHash,
        eventId: randomUUID(),
        now: new Date().toISOString(),
      });
      await updateFixtureOwnership(ownershipPaths.get(account.id), account.email, account.id);
    }
    for (const account of [owner, commenter]) {
      const agent = request.agent(app.getHttpServer());
      const bootstrap = await agent.get('/auth/csrf').expect(200);
      const login = await agent.post('/auth/login').set('Origin', origin)
        .set('X-CSRF-Token', bootstrap.body.csrfToken)
        .send({ email: account.email, password }).expect(200);
      assert.equal(login.body.user.id, account.id);
      const csrf = await agent.get('/auth/csrf').expect(200);
      actors.set(account.id, { agent, csrfToken: csrf.body.csrfToken });
    }

    const ownerActor = actors.get(owner.id);
    const commenterActor = actors.get(commenter.id);
    assert.ok(ownerActor && commenterActor);
    await request(app.getHttpServer()).get(`/posts/${postIds[0]}`).expect(401);
    const csrfRejected = await commenterActor.agent.put(`/posts/${postIds[0]}/like`)
      .set('Origin', origin).set('X-CSRF-Token', 'invalid-token').send();
    assert.equal(csrfRejected.status, 403);

    for (let index = 0; index < postIds.length; index += 1) {
      const post = await postsRepository.create({
        id: postIds[index], authorId: owner.id, content: `${marker} post ${index}`,
        visibility: index === 0 ? 'members' : 'friends', createdAt: new Date().toISOString(),
      });
      assert.ok(post);
    }

    await waitForRequests([0, 1].map(() => commenterActor.agent.put(`/posts/${postIds[0]}/like`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).send().expect((res) => assert.equal(res.status, 200, res.body?.error?.code))));
    await commenterActor.agent.put(`/posts/${postIds[0]}/like`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).send().expect(200);
    const liked = await ownerActor.agent.get(`/posts/${postIds[0]}`).expect(200);
    assert.equal(liked.body.post.likeCount, 1);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await commenterActor.agent.delete(`/posts/${postIds[0]}/like`)
        .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).expect(204);
    }
    const unliked = await commenterActor.agent.get(`/posts/${postIds[0]}`).expect(200);
    assert.equal(unliked.body.post.likeCount, 0);
    assert.equal(unliked.body.post.likedByViewer, false);
    await commenterActor.agent.get(`/posts/${postIds[1]}/comments`).expect(404);
    await commenterActor.agent.put(`/posts/${postIds[1]}/like`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).expect(404);

    const commentInput = { clientId: clientIds[0], content: `${marker} original comment` };
    const [first, repeated] = await waitForRequests([0, 1].map(() => commenterActor.agent.post(`/posts/${postIds[0]}/comments`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).send(commentInput).expect((res) => assert.equal(res.status, 201, res.body?.error?.code))));
    const commentId = first.body.comment.id;
    assert.equal(repeated.body.comment.id, commentId, 'Retry with the same clientId returns the same comment.');
    comments.push(commentId);
    await writeRecovery(recoveryPath, recovery, comments);

    const forbidden = await ownerActor.agent.patch(`/posts/${postIds[0]}/comments/${commentId}`)
      .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
      .send({ content: `${marker} forbidden`, expectedVersion: 0 });
    assert.equal(forbidden.status, 403, 'A post owner cannot edit a comment they did not write.');
    const edited = await commenterActor.agent.patch(`/posts/${postIds[0]}/comments/${commentId}`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken)
      .send({ content: `${marker} edited`, expectedVersion: 0 }).expect(200);
    assert.equal(edited.body.comment.version, 1);
    const commentsList = await ownerActor.agent.get(`/posts/${postIds[0]}/comments`).expect(200);
    assert.equal(commentsList.body.items.length, 1);
    assert.equal(commentsList.body.items[0].content, `${marker} edited`);
    const counted = await ownerActor.agent.get(`/posts/${postIds[0]}`).expect(200);
    assert.equal(counted.body.post.commentCount, 1);

    const additional = await commenterActor.agent.post(`/posts/${postIds[0]}/comments`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken)
      .send({ clientId: clientIds[2], content: `${marker} second page` }).expect(201);
    const additionalId = additional.body.comment.id;
    comments.push(additionalId);
    await writeRecovery(recoveryPath, recovery, comments);
    const firstPage = await ownerActor.agent.get(`/posts/${postIds[0]}/comments`).query({ limit: 1 }).expect(200);
    assert.equal(firstPage.body.pagination.hasMore, true);
    const cursor = firstPage.body.pagination.nextCursor;
    const lastPage = await ownerActor.agent.get(`/posts/${postIds[0]}/comments`).query({ limit: 1, cursor }).expect(200);
    assert.equal(lastPage.body.pagination.hasMore, false);
    assert.deepEqual(new Set([firstPage.body.items[0].id, lastPage.body.items[0].id]), new Set([commentId, additionalId]));
    await commenterActor.agent.get(`/posts/${postIds[0]}/comments`).query({ limit: 1, cursor }).expect(422);
    await commenterActor.agent.delete(`/posts/${postIds[0]}/comments/${additionalId}?expectedVersion=0`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).expect(204);

    const secondComment = await ownerActor.agent.post(`/posts/${postIds[1]}/comments`)
      .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken)
      .send({ clientId: clientIds[1], content: `${marker} cascade comment` }).expect(201);
    comments.push(secondComment.body.comment.id);
    await writeRecovery(recoveryPath, recovery, comments);
    await ownerActor.agent.delete(`/posts/${postIds[1]}?expectedVersion=0`)
      .set('Origin', origin).set('X-CSRF-Token', ownerActor.csrfToken).expect(204);
    const cascade = await session.run(
      'MATCH (node) WHERE (node:Post AND node.id=$postId) OR (node:Comment AND node.id=$commentId) RETURN count(node) AS count',
      { postId: postIds[1], commentId: secondComment.body.comment.id },
    );
    assert.equal(asNumber(cascade.records[0]?.get('count')), 0, 'Deleting a Post removes its comments.');

    await commenterActor.agent.delete(`/posts/${postIds[0]}/comments/${commentId}?expectedVersion=1`)
      .set('Origin', origin).set('X-CSRF-Token', commenterActor.csrfToken).expect(204);
    const deleted = await ownerActor.agent.get(`/posts/${postIds[0]}/comments`).expect(200);
    assert.equal(deleted.body.items.length, 0);
    if (process.env.ISN_INTERACTIONS_BROWSER === '1') {
      const { runInteractionsBrowser } = await import('../../e2e/specs/interactions-browser.mjs');
      await runInteractionsBrowser({ app, origin, root, account: owner, password, postId: postIds[0] });
      console.log('React / NestJS / Neo4j interaction journey PASS');
    }
    console.log(JSON.stringify({
      scenario: 'ISN-C-INTERACTIONS-HTTP', database: 'isn-test',
      databaseId: friendshipSupport.DATABASE_ID, schemaVersion: 6,
      checks: 'csrf/session/same-key-retry/ownership/counts/edit/delete/cascade',
      fixtureCounts: { users: 2, posts: 2, comments: comments.length },
    }));
  } finally {
    if (identityVerified && fixturesStarted && app && postsRepository) {
      try {
        for (const postId of postIds) {
          await postsRepository.delete({ viewerId: owner.id, postId, expectedVersion: 0 });
        }
        const nodes = await session.run(
          'MATCH (node) WHERE (node:Post AND node.id IN $postIds) OR (node:Comment AND node.clientId IN $clientIds AND node.postId IN $postIds) RETURN count(node) AS count',
          { postIds, clientIds },
        );
        assert.equal(asNumber(nodes.records[0]?.get('count')), 0, 'No owned posts or comments may remain.');
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (app) await app.close();
    if (identityVerified && fixturesStarted && !cleanupFailure) {
      try {
        const current = await session.run('CALL db.info() YIELD name,id RETURN name,id');
        assert.equal(current.records[0]?.get('name'), 'isn-test');
        assert.equal(current.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
        for (const account of [owner, commenter]) {
          await removeOwnedFixture(session, account.email, account.id);
        }
        const left = await session.run(
          'MATCH (node) WHERE (node:User AND node.id IN $ids) OR (node:Post AND node.id IN $postIds) OR (node:Comment AND node.clientId IN $clientIds AND node.postId IN $postIds) RETURN count(node) AS count',
          { ids: [owner.id, commenter.id], postIds, clientIds },
        );
        assert.equal(asNumber(left.records[0]?.get('count')), 0);
        if (recoveryPath) await rm(recoveryPath, { force: true });
      } catch (error) {
        cleanupFailure = error;
        console.error(JSON.stringify({
          scenario: 'ISN-C-INTERACTIONS-HTTP-CLEANUP', status: 'INCOMPLETE',
          fixtureIds: { users: [owner.id, commenter.id], posts: postIds, commentClientIds: clientIds },
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }));
      }
    }
    if (!fixturesStarted && !cleanupFailure) {
      if (recoveryPath) await rm(recoveryPath, { force: true });
      for (const path of ownershipPaths.values()) await rm(path, { force: true });
    }
    await session.close();
    await driver.close();
    for (const key of authKeys) {
      const previous = previousAuthEnvironment.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    if (authKeyDirectory) await rm(authKeyDirectory, { recursive: true, force: true });
    if (!cleanupFailure) {
      for (const path of ownershipPaths.values()) {
        await rm(path, { force: true });
      }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
});

function asNumber(value) {
  return typeof value === 'number' ? value : value?.toNumber?.() ?? Number(value);
}

async function writeRecovery(path, recovery, comments) {
  recovery.commentIds = [...comments];
  await writeFile(path, JSON.stringify(recovery), { mode: 0o600 });
}

async function waitForRequests(requests) {
  const results = await Promise.allSettled(requests);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}