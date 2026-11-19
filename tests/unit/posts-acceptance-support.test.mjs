import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { removeOwnedFixture } from '../integration/neo4j/fixture-ownership.mjs';
import {
  buildPostsRunManifest,
  assertPostsCleanupOwnership,
  capturePostsDataFingerprint,
  createPostsRunManifest,
  recordPostsFriendshipIntent,
  updatePostsFriendshipIntent,
  recordPostsPost,
  recordPostsFriendshipState,
  removePostsRunManifest,
  reservePostsFriendship,
  reservePostsFriendshipIntent,
  reservePostsPostIntent,
  reservePostsUser,
  savePostsRunManifest,
  splitApprovedPostPrivileges,
  validatePostsRunManifest,
} from '../fixtures/posts/acceptance-support.mjs';

const databaseId = '336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786';
const baseline = {
  dataFingerprint: 'a'.repeat(64),
  counts: { users: 0, sessions: 0, authEvents: 2, pairs: 0, friendships: 0, posts: 0, authored: 0 },
};
const firstUserId = '11111111-1111-4111-8111-111111111111';
const secondUserId = '22222222-2222-4222-8222-222222222222';

test('Posts run manifest stores only database identity, fingerprints, and exact synthetic ownership', () => {
  const manifest = buildPostsRunManifest({
    databaseId,
    baseline,
    runId: '33333333-3333-4333-8333-333333333333',
    pid: 123,
  });
  reservePostsUser(manifest, {
    id: firstUserId,
    email: `profile-${firstUserId}@example.invalid`,
    registrationEventId: '44444444-4444-4444-8444-444444444444',
  });

  validatePostsRunManifest(manifest, databaseId);
  assert.deepEqual(manifest.baseline, baseline);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'baseline', 'cleanup', 'database', 'databaseId', 'finishedAt', 'fixtures', 'pid', 'runId', 'startedAt', 'version',
  ]);
  const serialized = JSON.stringify(manifest);
  assert.equal(/password|cookie|token|passwordHash|privateKey/iu.test(serialized), false);
});

test('Posts run manifest rejects duplicate or non-owned users and non-canonical friendship pairs', () => {
  const manifest = buildPostsRunManifest({ databaseId, baseline });
  reservePostsUser(manifest, {
    id: firstUserId,
    email: `profile-${firstUserId}@example.invalid`,
    registrationEventId: '44444444-4444-4444-8444-444444444444',
  });
  reservePostsUser(manifest, {
    id: secondUserId,
    email: `profile-${secondUserId}@example.invalid`,
    registrationEventId: '55555555-5555-4555-8555-555555555555',
  });

  assert.throws(() => reservePostsUser(manifest, {
    id: firstUserId,
    email: `profile-${firstUserId}@example.invalid`,
    registrationEventId: '66666666-6666-4666-8666-666666666666',
  }));
  assert.throws(() => reservePostsFriendship(manifest, {
    lowUserId: secondUserId,
    highUserId: firstUserId,
    requestId: '77777777-7777-4777-8777-777777777777',
    requestStatus: 'ACCEPTED',
  }));
  assert.throws(() => reservePostsFriendship(manifest, {
    lowUserId: firstUserId,
    highUserId: '88888888-8888-4888-8888-888888888888',
    requestId: '99999999-9999-4999-8999-999999999999',
    requestStatus: 'PENDING',
  }));
});

test('Posts run manifest retains every lifecycle request and friendship identifier for exact recovery', () => {
  const manifest = buildPostsRunManifest({ databaseId, baseline });
  for (const [id, suffix] of [[firstUserId, '1'], [secondUserId, '2']]) {
    reservePostsUser(manifest, {
      id,
      email: `profile-${id}@example.invalid`,
      registrationEventId: `44444444-4444-4444-8444-44444444444${suffix}`,
    });
  }
  const pairKey = `${firstUserId}:${secondUserId}`;
  const firstRequest = '55555555-5555-4555-8555-555555555555';
  const firstFriendship = '66666666-6666-4666-8666-666666666666';
  reservePostsFriendship(manifest, {
    lowUserId: firstUserId,
    highUserId: secondUserId,
    requestId: firstRequest,
    requestStatus: 'PENDING',
    requestedAt: '2026-10-15T10:00:00.000Z',
  });
  recordPostsFriendshipState(manifest, pairKey, {
    requestId: firstRequest,
    requestStatus: 'ACCEPTED',
    friendshipId: firstFriendship,
    friendsSince: '2026-10-15T10:01:00.000Z',
    requestedAt: '2026-10-15T10:00:00.000Z',
    resolvedAt: '2026-10-15T10:01:00.000Z',
  });
  recordPostsFriendshipState(manifest, pairKey, {
    requestId: '77777777-7777-4777-8777-777777777777',
    requestStatus: 'PENDING',
    requestedAt: '2026-10-15T10:02:00.000Z',
  });

  validatePostsRunManifest(manifest, databaseId);
  assert.deepEqual(manifest.fixtures.friendships[0].requestIds, [
    firstRequest,
    '77777777-7777-4777-8777-777777777777',
  ]);
  assert.deepEqual(manifest.fixtures.friendships[0].friendshipIds, [firstFriendship]);
});

test('API-generated Friendship IDs are reserved by pair intent and retained across re-friending', () => {
  const manifest = buildPostsRunManifest({ databaseId, baseline });
  for (const [id, suffix] of [[firstUserId, '1'], [secondUserId, '2']]) {
    reservePostsUser(manifest, {
      id,
      email: `profile-${id}@example.invalid`,
      registrationEventId: `44444444-4444-4444-8444-44444444444${suffix}`,
    });
  }
  const pair = {
    lowUserId: firstUserId,
    highUserId: secondUserId,
    senderId: firstUserId,
    recipientId: secondUserId,
  };

  reservePostsFriendshipIntent(manifest, {
    ...pair, intentId: '88888888-8888-4888-8888-888888888888', requestedAt: '2026-10-15T10:00:00.000Z',
  });
  recordPostsFriendshipIntent(manifest, '88888888-8888-4888-8888-888888888888', {
    requestId: '99999999-9999-4999-8999-999999999999', requestStatus: 'PENDING',
  });
  updatePostsFriendshipIntent(manifest, '88888888-8888-4888-8888-888888888888', {
    requestStatus: 'ACCEPTED', friendshipId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    friendsSince: '2026-10-15T10:01:00.000Z', resolvedAt: '2026-10-15T10:01:00.000Z',
  });
  reservePostsFriendshipIntent(manifest, {
    ...pair, intentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    senderId: secondUserId, recipientId: firstUserId, requestedAt: '2026-10-15T10:02:00.000Z',
  });
  recordPostsFriendshipIntent(manifest, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', requestStatus: 'ACCEPTED',
    friendshipId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', friendsSince: '2026-10-15T10:03:00.000Z',
    resolvedAt: '2026-10-15T10:03:00.000Z',
  });

  validatePostsRunManifest(manifest, databaseId);
  assert.deepEqual(manifest.fixtures.friendships[0].requestIds, [
    '99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ]);
  assert.deepEqual(manifest.fixtures.friendships[0].friendshipIds, [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  ]);
  assert.equal(manifest.fixtures.friendshipIntents.length, 2);
  assert.throws(() => recordPostsFriendshipIntent(manifest, '88888888-8888-4888-8888-888888888888', {
    requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', requestStatus: 'PENDING',
  }));
});

test('Posts run manifest reserves creation intent before writes and binds returned IDs to its owner', () => {
  const manifest = buildPostsRunManifest({ databaseId, baseline });
  reservePostsUser(manifest, {
    id: firstUserId,
    email: `profile-${firstUserId}@example.invalid`,
    registrationEventId: '44444444-4444-4444-8444-444444444444',
  });
  reservePostsPostIntent(manifest, {
    authorId: firstUserId,
    marker: 'posts-fixture-abc123',
    visibility: 'friends',
  });

  assert.throws(() => recordPostsPost(manifest, {
    authorId: secondUserId,
    marker: 'posts-fixture-abc123',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }));
  recordPostsPost(manifest, {
    authorId: firstUserId,
    marker: 'posts-fixture-abc123',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  validatePostsRunManifest(manifest, databaseId);
  assert.deepEqual(manifest.fixtures.postIntents[0], {
    authorId: firstUserId,
    marker: 'posts-fixture-abc123',
    visibility: 'friends',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
});

test('Posts cleanup refuses an author mismatch, foreign author edge, or unexpected relationship before deletion', () => {
  const owned = { authorId: firstUserId, postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const exact = { declaredAuthor: firstUserId, authors: [firstUserId], authored: 1, relationships: 1 };

  assert.equal(assertPostsCleanupOwnership(owned, exact), true);
  assert.throws(() => assertPostsCleanupOwnership(owned, { ...exact, declaredAuthor: secondUserId }));
  assert.throws(() => assertPostsCleanupOwnership(owned, { ...exact, authors: [firstUserId, secondUserId], authored: 2, relationships: 2 }));
  assert.throws(() => assertPostsCleanupOwnership(owned, { ...exact, relationships: 2 }));
  assert.throws(() => assertPostsCleanupOwnership(owned, { ...exact, authored: 3, relationships: 3 }));
});

test('account cleanup refuses mismatched identity and unexpected relationships without writing', async () => {
  const email = `profile-${firstUserId}@example.invalid`;
  for (const scenario of [
    {
      owner: { id: secondUserId, email },
      relationships: [],
      refusal: /identity does not match/u,
      expectedQueries: 1,
    },
    {
      owner: { id: firstUserId, email },
      relationships: ['AUTHORED'],
      refusal: /unexpected relationship/u,
      expectedQueries: 2,
    },
  ]) {
    let queries = 0;
    let writes = 0;
    const session = {
      async run(query) {
        queries += 1;
        if (query.includes('RETURN user.id AS id, user.email AS email')) {
          return { records: [record(scenario.owner)] };
        }
        if (query.includes('collect(DISTINCT type(relationship))')) {
          return { records: [record({ types: scenario.relationships })] };
        }
        throw new Error('Unexpected cleanup query');
      },
      async executeWrite() { writes += 1; },
    };

    await assert.rejects(removeOwnedFixture(session, email, firstUserId), scenario.refusal);
    assert.equal(queries, scenario.expectedQueries);
    assert.equal(writes, 0);
  }
});

function record(values) {
  return { get: (key) => values[key] };
}

test('concurrent manifest saves serialize atomic replacements and preserve the latest ownership intents', async () => {
  const { path, manifest } = await createPostsRunManifest({ databaseId, baseline });
  try {
    reservePostsUser(manifest, {
      id: firstUserId,
      email: `profile-${firstUserId}@example.invalid`,
      registrationEventId: '44444444-4444-4444-8444-444444444444',
    });
    await savePostsRunManifest(path, manifest);

    const markers = Array.from({ length: 12 }, (_, index) => `posts-fixture-parallel-${index}`);
    const saves = markers.map(async (marker) => {
      reservePostsPostIntent(manifest, { authorId: firstUserId, marker, visibility: 'members' });
      await savePostsRunManifest(path, manifest);
    });
    const results = await Promise.allSettled(saves);

    assert.ok(results.every((result) => result.status === 'fulfilled'));
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    validatePostsRunManifest(persisted, databaseId);
    assert.deepEqual(persisted.fixtures.postIntents.map((intent) => intent.marker), markers);
  } finally {
    await rm(path, { force: true });
  }
});

test('preservation snapshot hashes existing and Posts graph data without returning private records', async () => {
  const first = await capturePostsDataFingerprint(snapshotSession('private@example.invalid'));
  const changed = await capturePostsDataFingerprint(snapshotSession('changed@example.invalid'));

  assert.equal(first.counts.users, 1);
  assert.equal(first.counts.posts, 0);
  assert.equal(first.counts.authored, 0);
  assert.notEqual(first.dataFingerprint, changed.dataFingerprint);
  assert.equal(JSON.stringify(first).includes('private@example.invalid'), false);
});

test('approved privilege split keeps the existing V4 grants separate from only Post/AUTHORED grants', () => {
  assert.deepEqual(splitApprovedPostPrivileges([
    'GRANT MATCH {*} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
    'GRANT MATCH {*} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
    'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP AUTHORED TO `isn_test_runner_role`',
  ]), {
    existing: ['GRANT MATCH {*} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`'],
    posts: [
      'GRANT MATCH {*} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
      'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP AUTHORED TO `isn_test_runner_role`',
    ],
  });
});

function snapshotSession(email) {
  const rows = new Map([
    ['MATCH (u:User)', [{
      id: firstUserId, email, passwordHash: 'private-hash', createdAt: 'created', updatedAt: 'updated',
      displayName: 'Private member', displayNameSearch: 'private member', bio: null, location: null,
      profileCreatedAt: 'profile-created', profileUpdatedAt: 'profile-updated', profileVersion: 0,
    }]],
    ['MATCH (s:AuthSession)', []],
    ['MATCH (event:AuthActivityEvent)', []],
    ['MATCH (pair:FriendshipPair)', []],
    ['MATCH (low:User)-[edge:FRIEND_WITH]->(high:User)', []],
    ['MATCH (post:Post)', []],
    ['MATCH (author)-[edge:AUTHORED]->(post)', []],
  ]);
  return {
    async run(query) {
      const match = [...rows].find(([needle]) => query.includes(needle));
      assert.ok(match, `Unexpected preservation query: ${query}`);
      return { records: match[1].map((values) => ({
        keys: Object.keys(values),
        get(key) { return values[key]; },
      })) };
    },
  };
}
