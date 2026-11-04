import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import neo4j from 'neo4j-driver';
import friendshipSupport from '../../fixtures/friendships/acceptance-support.cjs';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';

test('real Post likes and comments Cypher is verified in one rolled-back V6 transaction', async () => {
  assertPostsWriteWindow();

  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const session = driver.session({ database: 'isn-test' });
  let transaction;
  let transactionClosed = false;
  const ownerId = randomUUID();
  const commenterId = randomUUID();
  const postId = randomUUID();
  const cascadePostId = randomUUID();
  const marker = `interactions-${randomUUID()}`;

  try {
    await driver.verifyConnectivity();
    const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const principal = await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);

    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    const { PostsRepository } = await import('../../../apps/api/dist/modules/posts/posts.repository.js');
    const neo4jService = new Neo4jService(driver, 'isn-test');
    const status = await new Neo4jMigrationService(neo4jService).getStatus();
    assert.equal(status.status, 'current');
    assert.equal(status.version, 6);
    assert.equal(status.migrations.at(-1)?.name, 'post-likes-comments');

    transaction = await session.beginTransaction();
    const boundService = {
      executeRead: (work) => work(transaction),
      executeWriteOnce: (work) => work(transaction),
    };
    const repository = new PostsRepository(boundService);
    const now = new Date().toISOString();
    for (const [id, suffix] of [[ownerId, 'owner'], [commenterId, 'commenter']]) {
      await transaction.run(
        `CREATE (:User {id:$id,email:$email,displayName:$name,displayNameSearch:$name,
          profileCreatedAt:datetime($now),profileUpdatedAt:datetime($now),profileVersion:0})`,
        { id, email: `${suffix}-${id}@example.invalid`, name: `${suffix} ${marker}`, now },
      );
    }
    for (const id of [postId, cascadePostId]) {
      await repository.create({
        id, authorId: ownerId, content: `${marker} post`, visibility: 'members', createdAt: now,
      });
    }

    const firstLike = await repository.setLike(commenterId, postId, true);
    const repeatedLike = await repository.setLike(commenterId, postId, true);
    assert.deepEqual(firstLike, { liked: true });
    assert.deepEqual(repeatedLike, { liked: true });

    const input = { clientId: randomUUID(), content: `${marker} first comment` };
    const created = await repository.createComment(commenterId, postId, input);
    const replayed = await repository.createComment(commenterId, postId, input);
    assert.equal(replayed.comment.id, created.comment.id);
    const edited = await repository.updateComment(commenterId, postId, created.comment.id, `${marker} edited`, 0);
    assert.equal(edited.comment.version, 1);
    const replayAfterEdit = await repository.createComment(commenterId, postId, input);
    assert.equal(replayAfterEdit.comment.id, created.comment.id);
    assert.equal(replayAfterEdit.comment.content, `${marker} edited`);

    await assert.rejects(
      repository.updateComment(ownerId, postId, created.comment.id, `${marker} unauthorized`, 1),
      (error) => error?.outcome === 'forbidden',
    );
    const comments = await repository.listComments(ownerId, postId, undefined, 20);
    assert.deepEqual(comments.map((comment) => comment.id), [created.comment.id]);
    const postWithCounts = await repository.findVisible(ownerId, postId);
    assert.equal(postWithCounts.commentCount, 1);
    assert.equal(postWithCounts.likeCount, 1);

    const cascadeComment = await repository.createComment(commenterId, cascadePostId, {
      clientId: randomUUID(), content: `${marker} cascade comment`,
    });
    assert.equal(await repository.delete({ viewerId: ownerId, postId: cascadePostId, expectedVersion: 0 }), 'deleted');
    const cascadeResidue = await transaction.run(
      `MATCH (node) WHERE (node:Post AND node.id=$postId) OR (node:Comment AND node.id=$commentId)
       RETURN count(node) AS count`,
      { postId: cascadePostId, commentId: cascadeComment.comment.id },
    );
    assert.equal(cascadeResidue.records[0]?.get('count').toNumber(), 0);

    await transaction.rollback();
    transactionClosed = true;
    const after = await session.run(
      `MATCH (node)
       WHERE (node:User AND node.id IN $userIds) OR
             (node:Post AND node.id IN $postIds) OR
             (node:Comment AND node.postId IN $postIds)
       RETURN count(node) AS nodes`,
      { userIds: [ownerId, commenterId], postIds: [postId, cascadePostId] },
    );
    assert.equal(after.records[0]?.get('nodes').toNumber(), 0, 'Rollback must leave no fixture nodes.');
    const edgesAfter = await session.run(
      `MATCH (left)-[edge]->(right)
       WHERE (left:User AND left.id IN $userIds) OR (right:User AND right.id IN $userIds) OR
             (left:Post AND left.id IN $postIds) OR (right:Post AND right.id IN $postIds)
       RETURN count(edge) AS count`,
      { userIds: [ownerId, commenterId], postIds: [postId, cascadePostId] },
    );
    assert.equal(edgesAfter.records[0]?.get('count').toNumber(), 0, 'Rollback must leave no fixture relationships.');
  } finally {
    if (transaction && !transactionClosed) await transaction.rollback().catch(() => undefined);
    await session.close();
    await driver.close();
  }
});
