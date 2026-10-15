import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import neo4j from 'neo4j-driver';
import friendshipSupport from '../friendships/acceptance-support.cjs';
import { removeOwnedFixture, countAsNumber } from '../../integration/neo4j/fixture-ownership.mjs';
import {
  capturePostsDataFingerprint,
  createPostsRunManifest,
  recordPostsAuthState,
  assertPostsCleanupOwnership,
  recordPostsFriendshipIntent,
  recordPostsPost,
  removePostsRunManifest,
  reservePostsFriendshipIntent,
  reservePostsPostIntent,
  reservePostsUser,
  savePostsRunManifest,
  updatePostsFriendshipIntent,
  validatePostsRunManifest,
} from './acceptance-support.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const baselinePath = resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json');
const passwordPrefix = 'Weylume-Scenario-';

export async function createPostsScenario({ actorCount = 4 } = {}) {
  assert.ok(Number.isSafeInteger(actorCount) && actorCount >= 2 && actorCount <= 5);
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const session = driver.session({ database: 'isn-test' });
  let appModule;
  let scenario;

  try {
    const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const baselineFile = JSON.parse(await readFile(baselinePath, 'utf8'));
    const baseline = await capturePostsDataFingerprint(session);
    assert.equal(baseline.dataFingerprint, baselineFile.dataFingerprint);
    assert.deepEqual(baseline.counts, baselineFile.counts);

    const userIds = Array.from({ length: actorCount }, () => randomUUID()).sort();
    const users = userIds.map((id) => ({
      id,
      email: `profile-${id}@example.invalid`,
      password: `${passwordPrefix}${randomUUID()}!`,
      registrationEventId: randomUUID(),
    }));
    const collisions = await session.run(
      'MATCH (user:User) WHERE user.id IN $ids OR user.email IN $emails RETURN count(user) AS count',
      { ids: userIds, emails: users.map((user) => user.email) },
    );
    assert.equal(countAsNumber(collisions.records[0]?.get('count')), 0);
    const eventCollisions = await session.run(
      'MATCH (event:AuthActivityEvent) WHERE event.eventId IN $eventIds RETURN count(event) AS count',
      { eventIds: users.map((user) => user.registrationEventId) },
    );
    assert.equal(countAsNumber(eventCollisions.records[0]?.get('count')), 0);

    const { path: manifestPath, manifest } = await createPostsRunManifest({
      databaseId: friendshipSupport.DATABASE_ID,
      baseline,
    });
    scenario = { driver, session, manifestPath, manifest, users, contexts: [], appModule };
    for (const user of users) {
      reservePostsUser(manifest, user);
    }
    await savePostsRunManifest(manifestPath, manifest);

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../../apps/api/dist/app.module.js');
    appModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    scenario.appModule = appModule;
    const { AuthRepository } = await import('../../../apps/api/dist/modules/auth/auth.repository.js');
    const { PasswordService } = await import('../../../apps/api/dist/modules/auth/password.service.js');
    const auth = appModule.get(AuthRepository);
    const passwords = appModule.get(PasswordService);

    for (const user of users) {
      const passwordHash = await passwords.hash(user.password);
      const created = await auth.register({
        id: user.id,
        email: user.email,
        passwordHash,
        eventId: user.registrationEventId,
        now: new Date().toISOString(),
      });
      assert.deepEqual(created, { id: user.id, email: user.email });
      await savePostsRunManifest(manifestPath, manifest);
    }
    return scenario;
  } catch (error) {
    if (scenario) {
      try { await cleanupPostsScenario(scenario); } catch { /* Keep the durable manifest for exact recovery. */ }
    } else {
      await session.close().catch(() => undefined);
      await driver.close().catch(() => undefined);
    }
    throw error;
  }
}

export async function recordScenarioAuthState(scenario, userId) {
  const result = await scenario.session.run(
    `MATCH (user:User {id:$userId})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(session:AuthSession)
     WITH user,collect(DISTINCT session.id) AS sessionIds
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN sessionIds,collect(DISTINCT event.eventId) AS eventIds`,
    { userId },
  );
  if (result.records.length === 0) return false;
  assert.equal(result.records.length, 1);
  recordPostsAuthState(scenario.manifest, userId, {
    sessionIds: (result.records[0]?.get('sessionIds') ?? []).filter(Boolean),
    authEventIds: (result.records[0]?.get('eventIds') ?? []).filter(Boolean),
  });
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
  return true;
}

export async function reserveScenarioFriendship(scenario, { senderId, recipientId, requestedAt = new Date().toISOString() }) {
  const [lowUserId, highUserId] = [senderId, recipientId].sort();
  const intentId = reservePostsFriendshipIntent(scenario.manifest, {
    lowUserId, highUserId, senderId, recipientId, requestedAt,
  });
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
  return intentId;
}

export async function recordScenarioFriendshipCreated(scenario, intentId, requestId, requestedAt) {
  recordPostsFriendshipIntent(scenario.manifest, intentId, { requestId, requestStatus: 'PENDING', requestedAt });
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
}

export async function recordScenarioFriendshipResolved(scenario, intentId, result) {
  updatePostsFriendshipIntent(scenario.manifest, intentId, result);
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
}

export async function reserveScenarioPost(scenario, { authorId, marker, visibility }) {
  reservePostsPostIntent(scenario.manifest, { authorId, marker, visibility });
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
}

export async function recordScenarioPost(scenario, { authorId, marker, postId }) {
  recordPostsPost(scenario.manifest, { authorId, marker, postId });
  await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
}

export async function recordScenarioContext(scenario, context) {
  scenario.contexts.push(context);
}

export async function cleanupPostsScenario(scenario) {
  if (!scenario) return;
  for (const context of scenario.contexts.splice(0)) await context.close();
  validatePostsRunManifest(scenario.manifest, friendshipSupport.DATABASE_ID);
  const session = scenario.driver.session({ database: 'isn-test' });
  try {
    await assertCurrentIdentity(session, scenario.manifest.databaseId);
    await reconcileFriendshipIntents(session, scenario);
    await reconcilePostIntents(session, scenario);
    for (const user of scenario.manifest.fixtures.users) {
      await recordScenarioAuthState(scenario, user.userId);
    }
    await cleanupOwnedPosts(session, scenario);
    scenario.manifest.cleanup.postsRemoved = true;
    await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
    await cleanupOwnedFriendships(session, scenario);
    scenario.manifest.cleanup.friendshipsRemoved = true;
    await savePostsRunManifest(scenario.manifestPath, scenario.manifest);

    for (const user of scenario.manifest.fixtures.users) {
      await removeOwnedFixture(session, user.email, user.userId);
    }
    scenario.manifest.cleanup.accountsRemoved = true;
    await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
    await assertCurrentIdentity(session, scenario.manifest.databaseId);
    assert.deepEqual(await capturePostsDataFingerprint(session), scenario.manifest.baseline,
      'Posts scenario cleanup did not restore the exact pre-run application-data fingerprint.');
    scenario.manifest.cleanup.baselineRestored = true;
    scenario.manifest.finishedAt = new Date().toISOString();
    await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
    await removePostsRunManifest(scenario.manifestPath, scenario.manifest);
  } finally {
    await session.close();
    await scenario.appModule?.close();
    await scenario.driver.close();
  }
}

async function reconcileFriendshipIntents(session, scenario) {
  for (const intent of scenario.manifest.fixtures.friendshipIntents) {
    const rows = await session.run(
      `MATCH (pair:FriendshipPair {pairKey:$pairKey})
       RETURN pair.pairKey AS pairKey,pair.lowUserId AS lowUserId,pair.highUserId AS highUserId,
              pair.senderId AS senderId,pair.recipientId AS recipientId,pair.requestId AS requestId,
              pair.requestStatus AS requestStatus,toString(pair.requestedAt) AS requestedAt,
              pair.friendshipId AS friendshipId,toString(pair.friendsSince) AS friendsSince,
              toString(pair.resolvedAt) AS resolvedAt`,
      { pairKey: intent.pairKey },
    );
    assert.ok(rows.records.length <= 1, 'A fixture pair unexpectedly maps to multiple records.');
    const row = rows.records[0];
    if (!row) {
      assert.equal(intent.requestId, null, 'A persisted Friendship intent has no exact owned pair record.');
      continue;
    }
    assert.equal(row.get('lowUserId'), intent.lowUserId);
    assert.equal(row.get('highUserId'), intent.highUserId);
    if (intent.requestId === null) {
      assert.equal(row.get('senderId'), intent.senderId);
      assert.equal(row.get('recipientId'), intent.recipientId);
      assert.ok(Date.parse(String(row.get('requestedAt'))) >= Date.parse(intent.requestedAt));
      recordPostsFriendshipIntent(scenario.manifest, intent.intentId, {
        requestId: String(row.get('requestId')),
        requestStatus: String(row.get('requestStatus')),
        friendshipId: row.get('friendshipId') === null ? null : String(row.get('friendshipId')),
        friendsSince: row.get('friendsSince') === null ? null : String(row.get('friendsSince')),
        requestedAt: String(row.get('requestedAt')),
        resolvedAt: row.get('resolvedAt') === null ? null : String(row.get('resolvedAt')),
      });
      await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
    } else if (String(row.get('requestId')) === intent.requestId && intent.requestStatus === 'PENDING' &&
        row.get('requestStatus') !== 'PENDING') {
      assert.equal(row.get('senderId'), intent.senderId);
      assert.equal(row.get('recipientId'), intent.recipientId);
      assert.equal(row.get('requestedAt'), intent.requestedAt);
      updatePostsFriendshipIntent(scenario.manifest, intent.intentId, {
        requestStatus: String(row.get('requestStatus')),
        friendshipId: row.get('friendshipId') === null ? null : String(row.get('friendshipId')),
        friendsSince: row.get('friendsSince') === null ? null : String(row.get('friendsSince')),
        resolvedAt: row.get('resolvedAt') === null ? null : String(row.get('resolvedAt')),
      });
      await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
    }
  }
}

async function reconcilePostIntents(session, scenario) {
  for (const intent of scenario.manifest.fixtures.postIntents) {
    if (intent.postId !== null) continue;
    const result = await session.run(
      `MATCH (post:Post {authorId:$authorId})
       WHERE post.content CONTAINS $marker
       RETURN post.id AS id,post.content AS content,post.visibility AS visibility`,
      { authorId: intent.authorId, marker: intent.marker },
    );
    assert.ok(result.records.length <= 1, 'A Post ownership intent matched multiple records.');
    const row = result.records[0];
    if (!row) continue;
    assert.equal(row.get('visibility'), intent.visibility);
    recordPostsPost(scenario.manifest, {
      authorId: intent.authorId, marker: intent.marker, postId: String(row.get('id')),
    });
    await savePostsRunManifest(scenario.manifestPath, scenario.manifest);
  }
}

async function cleanupOwnedPosts(session, scenario) {
  for (const owned of scenario.manifest.fixtures.posts) {
    const result = await session.run(
      `MATCH (post:Post {id:$postId})
       OPTIONAL MATCH (author)-[edge:AUTHORED]->(post)
       WITH post,collect(DISTINCT author.id) AS authors,count(edge) AS authored
       OPTIONAL MATCH (post)-[relationship]-()
       RETURN post.authorId AS declaredAuthor,authors,authored,count(DISTINCT relationship) AS relationships`,
      { postId: owned.postId },
    );
    if (!result.records.length) continue;
    assert.equal(result.records.length, 1);
    const row = result.records[0];
    assertPostsCleanupOwnership(owned, {
      declaredAuthor: row.get('declaredAuthor'),
      authors: row.get('authors'),
      authored: countAsNumber(row.get('authored')),
      relationships: countAsNumber(row.get('relationships')),
    });
    await session.executeWrite((tx) => tx.run(
      `MATCH (author:User {id:$authorId})-[edge:AUTHORED]->(post:Post {id:$postId,authorId:$authorId})
       WITH post,collect(edge) AS edges
       FOREACH (edge IN edges | DELETE edge)
       DELETE post`,
      { authorId: owned.authorId, postId: owned.postId },
    ));
    const remaining = await session.run('MATCH (post:Post {id:$postId}) RETURN count(post) AS count', { postId: owned.postId });
    assert.equal(countAsNumber(remaining.records[0]?.get('count')), 0);
  }
}

async function cleanupOwnedFriendships(session, scenario) {
  for (const pair of scenario.manifest.fixtures.friendships) {
    for (const friendshipId of pair.friendshipIds) {
      const edge = await session.run(
        `MATCH (low:User {id:$low})-[relationship:FRIEND_WITH {id:$id,pairKey:$pairKey}]->(high:User {id:$high})
         RETURN relationship.id AS id`,
        { low: pair.lowUserId, high: pair.highUserId, id: friendshipId, pairKey: pair.pairKey },
      );
      assert.ok(edge.records.length <= 1);
      if (edge.records.length) {
        await session.run(
          `MATCH (low:User {id:$low})-[relationship:FRIEND_WITH {id:$id,pairKey:$pairKey}]->(high:User {id:$high})
           DELETE relationship`,
          { low: pair.lowUserId, high: pair.highUserId, id: friendshipId, pairKey: pair.pairKey },
        );
      }
    }
    const remainingEdges = await session.run(
      'MATCH ()-[edge:FRIEND_WITH {pairKey:$pairKey}]-() RETURN edge.id AS id', { pairKey: pair.pairKey },
    );
    assert.ok(remainingEdges.records.every((row) => !pair.friendshipIds.includes(String(row.get('id')))));
    assert.equal(remainingEdges.records.length, 0, 'An unowned Friendship edge blocks pair cleanup.');
    const node = await session.run(
      `MATCH (pair:FriendshipPair {pairKey:$pairKey})
       RETURN pair.lowUserId AS low,pair.highUserId AS high,pair.requestId AS requestId`,
      { pairKey: pair.pairKey },
    );
    assert.ok(node.records.length <= 1);
    if (node.records.length) {
      const row = node.records[0];
      assert.equal(row.get('low'), pair.lowUserId);
      assert.equal(row.get('high'), pair.highUserId);
      assert.ok(pair.requestIds.includes(String(row.get('requestId'))));
      await session.run(
        `MATCH (pair:FriendshipPair {pairKey:$pairKey,lowUserId:$low,highUserId:$high}) DELETE pair`,
        { pairKey: pair.pairKey, low: pair.lowUserId, high: pair.highUserId },
      );
    }
    const stillThere = await session.run('MATCH (pair:FriendshipPair {pairKey:$pairKey}) RETURN count(pair) AS count', {
      pairKey: pair.pairKey,
    });
    assert.equal(countAsNumber(stillThere.records[0]?.get('count')), 0);
  }
}

async function assertCurrentIdentity(session, databaseId) {
  const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
  assert.equal(identity.records[0]?.get('name'), 'isn-test');
  assert.equal(identity.records[0]?.get('id'), databaseId);
}
