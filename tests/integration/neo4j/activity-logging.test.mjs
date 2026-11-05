import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import neo4j from 'neo4j-driver';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';
import friendshipSupport from '../../fixtures/friendships/acceptance-support.cjs';

test('captures only applied v1 activity transitions and rolls the fixture back on V7', async () => {
  assertPostsWriteWindow();
  assert.equal(process.env.ACTIVITY_CAPTURE_ENABLED, 'true');
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(
    process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD,
  ));
  const session = driver.session({ database: 'isn-test' });
  const denied = driver.session({ database: 'isn-dev', defaultAccessMode: neo4j.session.READ });
  const [owner, actor] = [randomUUID(), randomUUID()];
  const postId = randomUUID();
  const now = new Date().toISOString();
  try {
    const identity = (await session.run('CALL db.info() YIELD name,id RETURN name,id')).records[0];
    assert.equal(identity?.get('name'), 'isn-test');
    assert.equal(identity?.get('id'), friendshipSupport.DATABASE_ID);
    const principal = (await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles')).records[0];
    assert.equal(principal?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    await assert.rejects(denied.run('CALL db.ping()'), (error) => /^Neo\.ClientError\.Security\./u.test(error?.code));

    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
    const { FriendshipsRepository } = await import('../../../apps/api/dist/modules/friendships/friendships.repository.js');
    const status = await new Neo4jMigrationService(new Neo4jService(driver, 'isn-test')).getStatus();
    assert.equal(status.status, 'current');
    assert.equal(status.version, 7);

    const tx = await session.beginTransaction();
    try {
      const bound = { executeRead: (work) => work(tx), executeWrite: (work) => work(tx), executeWriteOnce: (work) => work(tx) };
      const posts = new PostsRepository(bound);
      const friends = new FriendshipsRepository(bound);
      for (const id of [owner, actor]) {
        await tx.run(`CREATE (:User {id:$id,email:$email,displayName:'Activity fixture',
          displayNameSearch:'activity fixture',profileCreatedAt:datetime($now),
          profileUpdatedAt:datetime($now),profileVersion:0})`, { id, email: id + '@example.invalid', now });
      }

      for (const action of ['cancel', 'reject', 'accept']) {
        const requestId = randomUUID(), friendshipId = randomUUID();
        const request = { senderId: owner, recipientId: actor, requestId, now };
        assert.equal((await friends.createRequest(request)).kind, 'success');
        assert.equal((await friends.createRequest(request)).kind, 'conflict');
        const command = { actorId: action === 'cancel' ? owner : actor, requestId, action, friendshipId, now };
        assert.equal((await friends.actOnRequest(command)).kind, 'success');
        assert.equal((await friends.actOnRequest(command)).kind, 'success');
        if (action === 'accept') {
          await friends.unfriend(actor, friendshipId);
          await friends.unfriend(actor, friendshipId);
        }
      }

      await posts.create({ id: postId, authorId: owner, content: 'Fixture Post', visibility: 'members', createdAt: now });
      assert.equal(await posts.update({ viewerId: actor, postId, content: 'Forbidden', expectedVersion: 0, updatedAt: now }), 'forbidden');
      assert.equal((await posts.update({ viewerId: owner, postId, content: 'Updated fixture', expectedVersion: 0, updatedAt: now })).version, 1);
      for (const liked of [true, true, false, false]) await posts.setLike(actor, postId, liked);
      const input = { clientId: randomUUID(), content: 'Fixture comment' };
      const first = await posts.createComment(actor, postId, input);
      assert.equal((await posts.createComment(actor, postId, input)).comment.id, first.comment.id);
      await assert.rejects(posts.updateComment(owner, postId, first.comment.id, 'Forbidden', 0), (error) => error?.outcome === 'forbidden');
      await posts.updateComment(actor, postId, first.comment.id, 'Updated comment', 0);
      await posts.deleteComment(actor, postId, first.comment.id, 1);
      assert.equal(await posts.delete({ viewerId: owner, postId, expectedVersion: 1 }), 'deleted');

      const rows = await tx.run(`MATCH (event:ActivityEvent) WHERE event.actorId IN $actors
        RETURN event.eventType AS type,event.eventId AS id, keys(event) AS fields`, { actors: [owner, actor] });
      const expected = [
        'FRIEND_REQUEST_CREATED', 'FRIEND_REQUEST_CREATED', 'FRIEND_REQUEST_CREATED',
        'FRIEND_REQUEST_CANCELLED', 'FRIEND_REQUEST_REJECTED', 'FRIEND_REQUEST_ACCEPTED', 'FRIENDSHIP_REMOVED',
        'POST_CREATED', 'POST_UPDATED', 'POST_LIKED', 'POST_UNLIKED', 'POST_DELETED',
        'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED',
      ];
      assert.deepEqual(rows.records.map((row) => row.get('type')).sort(), expected.sort());
      assert.equal(new Set(rows.records.map((row) => row.get('id'))).size, expected.length);
      const allowed = new Set(['eventId', 'schemaVersion', 'eventType', 'occurredAt', 'source', 'actorId', 'targetUserId', 'objectType', 'objectId']);
      assert.ok(rows.records.every((row) => row.get('fields').every((key) => allowed.has(key))));
    } finally {
      await tx.rollback();
    }
    const remaining = await session.run(`CALL { MATCH (u:User) WHERE u.id IN $actors RETURN count(u) AS users }
      CALL { MATCH (event:ActivityEvent) WHERE event.actorId IN $actors RETURN count(event) AS events }
      RETURN users,events`, { actors: [owner, actor] });
    assert.equal(remaining.records[0].get('users').toNumber(), 0);
    assert.equal(remaining.records[0].get('events').toNumber(), 0);
  } finally {
    await Promise.all([session.close(), denied.close()]);
    await driver.close();
  }
});
