import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import neo4j from 'neo4j-driver';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';
import support from '../../fixtures/friendships/acceptance-support.cjs';
import { capturePostsDataFingerprint } from '../../fixtures/posts/acceptance-support.mjs';

test('concurrent idempotent interactions commit one event per applied change', async () => {
  assertPostsWriteWindow();
  assert.equal(process.env.ACTIVITY_CAPTURE_ENABLED, 'true');
  const directory = '.artifacts/weylume/activity-acceptance';
  await mkdir(directory, { recursive: true });
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.json')).length, 0, 'Unresolved activity fixture');
  const owner = randomUUID(), actor = randomUUID(), postId = randomUUID();
  const users = [owner, actor];
  const manifest = directory + '/' + randomUUID() + '.json';
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD));
  const session = driver.session({ database: 'isn-test' });
  let baseline, repository, ownsFixture = false, clean = false;
  try {
    const info = (await session.run('CALL db.info() YIELD name,id RETURN name,id')).records[0];
    assert.equal(info.get('name'), 'isn-test');
    assert.equal(info.get('id'), support.DATABASE_ID);
    const principal = (await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles')).records[0];
    assert.equal(principal.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
    const service = new Neo4jService(driver, 'isn-test');
    const schema = await new Neo4jMigrationService(service).getStatus();
    assert.equal(schema.status, 'current');
    assert.equal(schema.version, 7);
    baseline = await capturePostsDataFingerprint(session);
    const oldEvents = await session.run('MATCH (event:ActivityEvent) RETURN count(event) AS count');
    assert.equal(oldEvents.records[0].get('count').toNumber(), 0);
    const occupied = await session.run('MATCH (node) WHERE node.id IN $ids OR (node:ActivityEvent AND node.actorId IN $actors) RETURN count(node) AS count',
      { ids: [...users, postId], actors: users });
    assert.equal(occupied.records[0].get('count').toNumber(), 0);
    await writeFile(manifest, JSON.stringify({ database: 'isn-test', databaseId: support.DATABASE_ID, users, postId }), { flag: 'wx', mode: 0o600 });
    ownsFixture = true;
    const now = new Date().toISOString();
    for (const id of users) await session.run(`CREATE (:User {id:$id,email:$email,displayName:'Activity fixture',
      displayNameSearch:'activity fixture',profileVersion:0,profileCreatedAt:datetime($now),profileUpdatedAt:datetime($now)})`,
    { id, email: id + '@example.invalid', now });
    repository = new PostsRepository(service);
    await repository.create({ id: postId, authorId: owner, content: 'Concurrent activity fixture', visibility: 'members', createdAt: now });
    const runTogether = async (work) => {
      const results = await Promise.allSettled([work(), work()]);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
      return results.map((result) => result.value);
    };
    const likes = await runTogether(() => repository.setLike(actor, postId, true));
    assert.ok(likes.every((value) => value.liked === true));
    const input = { clientId: randomUUID(), content: 'Concurrent comment fixture' };
    const comments = await runTogether(() => repository.createComment(actor, postId, input));
    assert.equal(comments[0].comment.id, comments[1].comment.id);
    const events = await session.run(`MATCH (event:ActivityEvent) WHERE event.actorId IN $actors
      RETURN event.eventType AS type,count(event) AS count`, { actors: users });
    assert.deepEqual(Object.fromEntries(events.records.map((row) => [row.get('type'), row.get('count').toNumber()])),
      { POST_CREATED: 1, POST_LIKED: 1, COMMENT_CREATED: 1 });
  } finally {
    if (ownsFixture) {
      if (!repository) {
        const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
        const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
        repository = new PostsRepository(new Neo4jService(driver, 'isn-test'));
      }
      try {
        const post = await repository.findVisible(owner, postId);
        if (post) assert.equal(await repository.delete({ viewerId: owner, postId, expectedVersion: post.version }), 'deleted');
        await session.executeWrite(async (tx) => {
          await tx.run('MATCH (event:ActivityEvent) WHERE event.actorId IN $actors DELETE event', { actors: users });
          for (const id of users) await tx.run('MATCH (user:User {id:$id,email:$email}) DELETE user', { id, email: id + '@example.invalid' });
        });
        assert.deepEqual(await capturePostsDataFingerprint(session), baseline);
        const remaining = await session.run('MATCH (event:ActivityEvent) WHERE event.actorId IN $actors RETURN count(event) AS count', { actors: users });
        assert.equal(remaining.records[0].get('count').toNumber(), 0);
        await unlink(manifest);
        clean = true;
      } finally {
        await session.close();
        await driver.close();
      }
      assert.equal(clean, true, 'Cleanup must complete');
    } else {
      await session.close();
      await driver.close();
    }
  }
});
