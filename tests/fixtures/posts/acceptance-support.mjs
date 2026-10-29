import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

const runDirectory = resolve('.artifacts/weylume/posts-acceptance');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const fingerprintPattern = /^[a-f0-9]{64}$/u;
const statuses = new Set(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']);
const manifestSaveQueues = new Map();

export function buildPostsRunManifest({ databaseId, baseline, runId = randomUUID(), pid = process.pid }) {
  assert.match(databaseId, /^[A-F0-9]{64}$/u);
  assert.match(runId, uuidPattern);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assertValidBaseline(baseline);
  const cleanup = {
    postsRemoved: false,
    friendshipsRemoved: false,
    accountsRemoved: false,
    baselineRestored: false,
  };
  return {
    version: 1,
    runId,
    pid,
    database: 'isn-test',
    databaseId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    baseline: structuredClone(baseline),
    fixtures: { users: [], friendships: [], friendshipIntents: [], postIntents: [], posts: [] },
    cleanup,
  };
}

export function reservePostsUser(manifest, { id, email, registrationEventId }) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.match(id, uuidPattern);
  assert.equal(email, `profile-${id}@example.invalid`);
  assert.match(registrationEventId, uuidPattern);
  assert.equal(manifest.fixtures.users.some((user) => user.userId === id || user.email === email), false,
    'A Posts run cannot claim the same account twice.');
  manifest.fixtures.users.push({
    userId: id,
    email,
    registrationEventId,
    sessionIds: [],
    authEventIds: [registrationEventId],
  });
}

export function reservePostsFriendship(manifest, {
  lowUserId,
  highUserId,
  requestId,
  requestStatus,
  friendshipId = null,
  friendsSince = null,
  requestedAt = new Date().toISOString(),
  resolvedAt = null,
}) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.match(lowUserId, uuidPattern);
  assert.match(highUserId, uuidPattern);
  assert.ok(lowUserId < highUserId, 'Friendship fixture endpoints must be canonical.');
  assert.ok(manifest.fixtures.users.some((user) => user.userId === lowUserId));
  assert.ok(manifest.fixtures.users.some((user) => user.userId === highUserId));
  assert.match(requestId, uuidPattern);
  assert.ok(statuses.has(requestStatus));
  assert.equal(manifest.fixtures.friendships.some((pair) => pair.pairKey === `${lowUserId}:${highUserId}`), false);
  if (requestStatus === 'ACCEPTED') {
    assert.match(friendshipId ?? '', uuidPattern);
    assert.equal(typeof friendsSince, 'string');
    assert.equal(typeof resolvedAt, 'string');
  } else {
    assert.equal(friendshipId, null);
    assert.equal(friendsSince, null);
    assert.equal(requestStatus === 'PENDING' ? resolvedAt : typeof resolvedAt === 'string',
      requestStatus === 'PENDING' ? null : true);
  }
  manifest.fixtures.friendships.push({
    pairKey: `${lowUserId}:${highUserId}`,
    lowUserId,
    highUserId,
    requestId,
    requestIds: [requestId],
    requestStatus,
    friendshipId,
    friendshipIds: friendshipId === null ? [] : [friendshipId],
    friendsSince,
    requestedAt,
    resolvedAt,
  });
}

export function reservePostsFriendshipIntent(manifest, {
  intentId = randomUUID(),
  lowUserId,
  highUserId,
  senderId,
  recipientId,
  requestedAt = new Date().toISOString(),
}) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.match(intentId, uuidPattern);
  assert.match(lowUserId, uuidPattern);
  assert.match(highUserId, uuidPattern);
  assert.ok(lowUserId < highUserId, 'Friendship intent endpoints must be canonical.');
  assert.ok(senderId === lowUserId || senderId === highUserId);
  assert.ok(recipientId === lowUserId || recipientId === highUserId);
  assert.notEqual(senderId, recipientId);
  assert.ok(manifest.fixtures.users.some((user) => user.userId === senderId));
  assert.ok(manifest.fixtures.users.some((user) => user.userId === recipientId));
  assert.ok(Number.isFinite(Date.parse(requestedAt)));
  assert.equal(manifest.fixtures.friendshipIntents.some((intent) => intent.intentId === intentId), false);
  assert.equal(manifest.fixtures.friendshipIntents.some((intent) =>
    intent.pairKey === `${lowUserId}:${highUserId}` && intent.requestId === null), false,
  'Resolve an earlier friendship intent before reserving another request for the pair.');
  manifest.fixtures.friendshipIntents.push({
    intentId,
    pairKey: `${lowUserId}:${highUserId}`,
    lowUserId,
    highUserId,
    senderId,
    recipientId,
    requestedAt,
    requestId: null,
    requestStatus: null,
    friendshipId: null,
    friendsSince: null,
    resolvedAt: null,
  });
  return intentId;
}

export function recordPostsFriendshipIntent(manifest, intentId, {
  requestId,
  requestStatus,
  friendshipId = null,
  friendsSince = null,
  requestedAt,
  resolvedAt = null,
}) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  const intent = manifest.fixtures.friendshipIntents.find((item) => item.intentId === intentId);
  assert.ok(intent, 'Friendship result must match a durable pre-write intent.');
  assert.equal(intent.requestId, null, 'A Friendship intent may only be reconciled once.');
  assert.match(requestId ?? '', uuidPattern);
  assert.ok(statuses.has(requestStatus));
  requestedAt ??= intent.requestedAt;
  assert.ok(Number.isFinite(Date.parse(requestedAt)));
  assert.ok(Date.parse(requestedAt) >= Date.parse(intent.requestedAt),
    'The persisted request must not predate its write-ahead intent.');
  if (requestStatus === 'ACCEPTED') {
    assert.match(friendshipId ?? '', uuidPattern);
    assert.ok(typeof friendsSince === 'string' && Number.isFinite(Date.parse(friendsSince)));
    assert.ok(typeof resolvedAt === 'string' && Number.isFinite(Date.parse(resolvedAt)));
  } else {
    assert.equal(friendshipId, null);
    assert.equal(friendsSince, null);
    assert.equal(requestStatus === 'PENDING' ? resolvedAt : typeof resolvedAt === 'string',
      requestStatus === 'PENDING' ? null : true);
  }
  const existing = manifest.fixtures.friendships.find((pair) => pair.pairKey === intent.pairKey);
  if (existing) {
    recordPostsFriendshipState(manifest, intent.pairKey, {
      requestId, requestStatus, friendshipId, friendsSince,
      requestedAt, resolvedAt,
    });
  } else {
    reservePostsFriendship(manifest, {
      lowUserId: intent.lowUserId,
      highUserId: intent.highUserId,
      requestId,
      requestStatus,
      friendshipId,
      friendsSince,
      requestedAt,
      resolvedAt,
    });
  }
  intent.requestId = requestId;
  intent.requestStatus = requestStatus;
  intent.requestedAt = requestedAt;
  intent.friendshipId = friendshipId;
  intent.friendsSince = friendsSince;
  intent.resolvedAt = resolvedAt;
  validatePostsRunManifest(manifest, manifest.databaseId);
}

export function recordPostsFriendshipState(manifest, pairKey, {
  requestId,
  requestStatus,
  friendshipId = null,
  friendsSince = null,
  requestedAt,
  resolvedAt = null,
}) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  const pair = manifest.fixtures.friendships.find((item) => item.pairKey === pairKey);
  assert.ok(pair, 'Friendship pair ownership must be durable before its first write.');
  assert.match(requestId, uuidPattern);
  assert.ok(statuses.has(requestStatus));
  if (!pair.requestIds.includes(requestId)) pair.requestIds.push(requestId);
  if (friendshipId !== null && !pair.friendshipIds.includes(friendshipId)) pair.friendshipIds.push(friendshipId);
  pair.requestId = requestId;
  pair.requestStatus = requestStatus;
  pair.friendshipId = friendshipId;
  pair.friendsSince = friendsSince;
  pair.requestedAt = requestedAt;
  pair.resolvedAt = resolvedAt;
}

export function updatePostsFriendshipIntent(manifest, intentId, {
  requestStatus,
  friendshipId = null,
  friendsSince = null,
  resolvedAt,
}) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  const intent = manifest.fixtures.friendshipIntents.find((item) => item.intentId === intentId);
  assert.ok(intent && intent.requestId, 'Only a reconciled Friendship request can change state.');
  assert.equal(intent.requestStatus, 'PENDING', 'Only an owned pending request can be resolved.');
  assert.ok(requestStatus === 'ACCEPTED' || requestStatus === 'REJECTED' || requestStatus === 'CANCELLED');
  if (requestStatus === 'ACCEPTED') {
    assert.match(friendshipId ?? '', uuidPattern);
    assert.ok(typeof friendsSince === 'string' && Number.isFinite(Date.parse(friendsSince)));
  } else {
    assert.equal(friendshipId, null);
    assert.equal(friendsSince, null);
  }
  assert.ok(typeof resolvedAt === 'string' && Number.isFinite(Date.parse(resolvedAt)));
  recordPostsFriendshipState(manifest, intent.pairKey, {
    requestId: intent.requestId,
    requestStatus,
    friendshipId,
    friendsSince,
    requestedAt: intent.requestedAt,
    resolvedAt,
  });
  intent.requestStatus = requestStatus;
  intent.friendshipId = friendshipId;
  intent.friendsSince = friendsSince;
  intent.resolvedAt = resolvedAt;
  validatePostsRunManifest(manifest, manifest.databaseId);
}

export function reservePostsPostIntent(manifest, { authorId, marker, visibility }) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.ok(manifest.fixtures.users.some((user) => user.userId === authorId));
  assert.match(marker, /^posts-fixture-[a-z0-9-]{6,64}$/u);
  assert.ok(visibility === 'friends' || visibility === 'members');
  assert.equal(manifest.fixtures.postIntents.some((intent) => intent.marker === marker), false);
  manifest.fixtures.postIntents.push({ authorId, marker, visibility, postId: null });
}

export function recordPostsPost(manifest, { authorId, marker, postId }) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.match(postId, uuidPattern);
  const intent = manifest.fixtures.postIntents.find((item) => item.marker === marker && item.authorId === authorId);
  assert.ok(intent, 'A Post ID must match a durable pre-write creation intent.');
  assert.equal(intent.postId, null, 'A Post creation intent may only be completed once.');
  assert.equal(manifest.fixtures.posts.some((post) => post.postId === postId), false);
  intent.postId = postId;
  manifest.fixtures.posts.push({ postId, authorId, marker });
}

export function assertPostsCleanupOwnership(owned, observation) {
  assert.match(owned.authorId, uuidPattern);
  assert.match(owned.postId, uuidPattern);
  assert.equal(observation.declaredAuthor, owned.authorId);
  assert.ok(Array.isArray(observation.authors) && observation.authors.length > 0);
  assert.ok(observation.authors.every((authorId) => authorId === owned.authorId));
  assert.ok(Number.isSafeInteger(observation.authored) && observation.authored > 0 && observation.authored <= 2);
  assert.equal(observation.relationships, observation.authored,
    'Unexpected relationships block exact Post cleanup.');
  return true;
}

export function recordPostsAuthState(manifest, userId, { sessionIds, authEventIds }) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  const fixture = manifest.fixtures.users.find((user) => user.userId === userId);
  assert.ok(fixture, 'Authentication records must be attached to an owned Posts fixture user.');
  assertUuidList(sessionIds);
  assertUuidList(authEventIds);
  fixture.sessionIds = [...new Set(sessionIds)];
  fixture.authEventIds = [...new Set(authEventIds)];
}

export function splitApprovedPostPrivileges(privileges) {
  assert.ok(Array.isArray(privileges));
  assert.equal(new Set(privileges).size, privileges.length);
  const posts = privileges.filter((command) => /\bNODE Post\b|\bRELATIONSHIP AUTHORED\b/u.test(command));
  return {
    existing: privileges.filter((command) => !posts.includes(command)),
    posts,
  };
}

export async function capturePostsDataFingerprint(session) {
  const queries = {
    users: `MATCH (u:User) RETURN u.id AS id,u.email AS email,u.passwordHash AS passwordHash,
      toString(u.createdAt) AS createdAt,toString(u.updatedAt) AS updatedAt,u.displayName AS displayName,
      u.displayNameSearch AS displayNameSearch,u.bio AS bio,u.location AS location,
      toString(u.profileCreatedAt) AS profileCreatedAt,toString(u.profileUpdatedAt) AS profileUpdatedAt,
      u.profileVersion AS profileVersion ORDER BY id`,
    sessions: `MATCH (s:AuthSession) OPTIONAL MATCH (user:User)-[:HAS_AUTH_SESSION]->(s)
      RETURN s.id AS id,s.jti AS jti,toString(s.createdAt) AS createdAt,
      toString(s.expiresAt) AS expiresAt,toString(s.revokedAt) AS revokedAt,
      collect(DISTINCT user.id) AS userIds ORDER BY id`,
    authEvents: `MATCH (event:AuthActivityEvent) OPTIONAL MATCH (user:User)-[:PERFORMED_AUTH_EVENT]->(event)
      RETURN event.eventId AS id,event.userId AS userId,event.sessionId AS sessionId,
      event.eventType AS eventType,event.schemaVersion AS schemaVersion,toString(event.timestamp) AS timestamp,
      event.source AS source,collect(DISTINCT user.id) AS userIds ORDER BY id`,
    pairs: `MATCH (pair:FriendshipPair) RETURN pair.pairKey AS pairKey,pair.lowUserId AS lowUserId,
      pair.highUserId AS highUserId,pair.version AS version,pair.requestId AS requestId,
      pair.senderId AS senderId,pair.recipientId AS recipientId,pair.requestStatus AS requestStatus,
      toString(pair.requestedAt) AS requestedAt,toString(pair.resolvedAt) AS resolvedAt,
      pair.friendshipId AS friendshipId,toString(pair.friendsSince) AS friendsSince ORDER BY pairKey`,
    friendships: `MATCH (low:User)-[edge:FRIEND_WITH]->(high:User)
      RETURN low.id AS lowUserId,high.id AS highUserId,edge.id AS id,edge.pairKey AS pairKey,
      toString(edge.since) AS since ORDER BY pairKey`,
    posts: `MATCH (post:Post) RETURN post.id AS id,post.authorId AS authorId,post.content AS content,
      post.visibility AS visibility,toString(post.createdAt) AS createdAt,toString(post.updatedAt) AS updatedAt,
      post.version AS version ORDER BY id`,
    authored: `MATCH (author)-[edge:AUTHORED]->(post)
      RETURN labels(author) AS authorLabels,author.id AS authorId,labels(post) AS postLabels,
      post.id AS postId,post.authorId AS declaredAuthorId ORDER BY postId,authorId`,
  };
  const data = {};
  for (const [name, query] of Object.entries(queries)) {
    const result = await session.run(query);
    data[name] = result.records.map((record) => Object.fromEntries(
      record.keys.map((key) => [key, canonical(record.get(key))]),
    ));
  }
  const counts = {
    users: data.users.length,
    sessions: data.sessions.length,
    authEvents: data.authEvents.length,
    pairs: data.pairs.length,
    friendships: data.friendships.length,
    posts: data.posts.length,
    authored: data.authored.length,
  };
  return {
    dataFingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    counts,
  };
}

export function validatePostsRunManifest(manifest, expectedDatabaseId) {
  assert.ok(manifest && typeof manifest === 'object');
  assert.deepEqual(Object.keys(manifest).sort(), [
    'baseline', 'cleanup', 'database', 'databaseId', 'finishedAt', 'fixtures', 'pid', 'runId', 'startedAt', 'version',
  ]);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.database, 'isn-test');
  assert.equal(manifest.databaseId, expectedDatabaseId);
  assert.match(manifest.databaseId, /^[A-F0-9]{64}$/u);
  assert.match(manifest.runId, uuidPattern);
  assert.ok(Number.isSafeInteger(manifest.pid) && manifest.pid > 0);
  assert.ok(Number.isFinite(Date.parse(manifest.startedAt)));
  assert.ok(manifest.finishedAt === null || Number.isFinite(Date.parse(manifest.finishedAt)));
  assertValidBaseline(manifest.baseline);
  assert.deepEqual(Object.keys(manifest.fixtures).sort(), ['friendshipIntents', 'friendships', 'postIntents', 'posts', 'users']);
  assert.deepEqual(Object.keys(manifest.cleanup).sort(), [
    'accountsRemoved', 'baselineRestored', 'friendshipsRemoved', 'postsRemoved',
  ]);
  assert.ok(Object.values(manifest.cleanup).every((value) => typeof value === 'boolean'));

  const users = manifest.fixtures.users;
  assert.ok(Array.isArray(users));
  assert.equal(new Set(users.map((user) => user.userId)).size, users.length);
  assert.equal(new Set(users.map((user) => user.email)).size, users.length);
  for (const user of users) {
    assert.deepEqual(Object.keys(user).sort(), ['authEventIds', 'email', 'registrationEventId', 'sessionIds', 'userId']);
    assert.match(user.userId, uuidPattern);
    assert.equal(user.email, `profile-${user.userId}@example.invalid`);
    assert.match(user.registrationEventId, uuidPattern);
    assertUuidList(user.sessionIds);
    assertUuidList(user.authEventIds);
  }

  const userIds = new Set(users.map((user) => user.userId));
  const friendships = manifest.fixtures.friendships;
  assert.ok(Array.isArray(friendships));
  assert.equal(new Set(friendships.map((pair) => pair.pairKey)).size, friendships.length);
  for (const pair of friendships) {
    assert.deepEqual(Object.keys(pair).sort(), [
      'friendsSince', 'friendshipId', 'friendshipIds', 'highUserId', 'lowUserId', 'pairKey', 'requestId',
      'requestIds', 'requestStatus', 'requestedAt', 'resolvedAt',
    ]);
    assert.ok(userIds.has(pair.lowUserId) && userIds.has(pair.highUserId));
    assert.ok(pair.lowUserId < pair.highUserId);
    assert.equal(pair.pairKey, `${pair.lowUserId}:${pair.highUserId}`);
    assert.match(pair.requestId, uuidPattern);
    assertUuidList(pair.requestIds);
    assert.ok(pair.requestIds.includes(pair.requestId));
    assertUuidList(pair.friendshipIds);
    assert.ok(statuses.has(pair.requestStatus));
    if (pair.friendshipId !== null) {
      assert.match(pair.friendshipId, uuidPattern);
      assert.ok(pair.friendshipIds.includes(pair.friendshipId));
    }
    if (pair.requestStatus === 'ACCEPTED') {
      assert.ok((pair.friendshipId === null) === (pair.friendsSince === null));
      assert.ok(typeof pair.resolvedAt === 'string');
    } else {
      assert.equal(pair.friendshipId, null);
      assert.equal(pair.friendsSince, null);
      assert.equal(pair.requestStatus === 'PENDING' ? pair.resolvedAt : typeof pair.resolvedAt,
        pair.requestStatus === 'PENDING' ? null : 'string');
    }
  }

  const friendshipIntents = manifest.fixtures.friendshipIntents;
  assert.ok(Array.isArray(friendshipIntents));
  assert.equal(new Set(friendshipIntents.map((intent) => intent.intentId)).size, friendshipIntents.length);
  for (const intent of friendshipIntents) {
    assert.deepEqual(Object.keys(intent).sort(), [
      'friendsSince', 'friendshipId', 'highUserId', 'intentId', 'lowUserId', 'pairKey', 'recipientId',
      'requestId', 'requestStatus', 'requestedAt', 'resolvedAt', 'senderId',
    ]);
    assert.match(intent.intentId, uuidPattern);
    assert.ok(userIds.has(intent.lowUserId) && userIds.has(intent.highUserId));
    assert.ok(intent.lowUserId < intent.highUserId);
    assert.equal(intent.pairKey, `${intent.lowUserId}:${intent.highUserId}`);
    assert.ok([intent.lowUserId, intent.highUserId].includes(intent.senderId));
    assert.ok([intent.lowUserId, intent.highUserId].includes(intent.recipientId));
    assert.notEqual(intent.senderId, intent.recipientId);
    assert.ok(Number.isFinite(Date.parse(intent.requestedAt)));
    if (intent.requestId === null) {
      assert.equal(intent.requestStatus, null);
      assert.equal(intent.friendshipId, null);
      assert.equal(intent.friendsSince, null);
      assert.equal(intent.resolvedAt, null);
    } else {
      assert.match(intent.requestId, uuidPattern);
      assert.ok(statuses.has(intent.requestStatus));
      const pair = friendships.find((item) => item.pairKey === intent.pairKey);
      assert.ok(pair?.requestIds.includes(intent.requestId));
      if (intent.requestStatus === 'ACCEPTED') {
        assert.match(intent.friendshipId ?? '', uuidPattern);
        assert.ok(pair.friendshipIds.includes(intent.friendshipId));
        assert.ok(Number.isFinite(Date.parse(intent.friendsSince)));
        assert.ok(Number.isFinite(Date.parse(intent.resolvedAt)));
      } else {
        assert.equal(intent.friendshipId, null);
        assert.equal(intent.friendsSince, null);
        assert.equal(intent.requestStatus === 'PENDING' ? intent.resolvedAt : typeof intent.resolvedAt,
          intent.requestStatus === 'PENDING' ? null : 'string');
      }
    }
  }

  const intents = manifest.fixtures.postIntents;
  assert.ok(Array.isArray(intents));
  assert.equal(new Set(intents.map((intent) => intent.marker)).size, intents.length);
  for (const intent of intents) {
    assert.deepEqual(Object.keys(intent).sort(), ['authorId', 'marker', 'postId', 'visibility']);
    assert.ok(userIds.has(intent.authorId));
    assert.match(intent.marker, /^posts-fixture-[a-z0-9-]{6,64}$/u);
    assert.ok(intent.visibility === 'friends' || intent.visibility === 'members');
    if (intent.postId !== null) assert.match(intent.postId, uuidPattern);
  }

  const posts = manifest.fixtures.posts;
  assert.ok(Array.isArray(posts));
  assert.equal(new Set(posts.map((post) => post.postId)).size, posts.length);
  for (const post of posts) {
    assert.deepEqual(Object.keys(post).sort(), ['authorId', 'marker', 'postId']);
    assert.ok(userIds.has(post.authorId));
    assert.match(post.postId, uuidPattern);
    assert.ok(intents.some((intent) => intent.authorId === post.authorId && intent.marker === post.marker && intent.postId === post.postId));
  }
  return manifest;
}

export async function createPostsRunManifest(options) {
  const manifest = buildPostsRunManifest(options);
  await mkdir(runDirectory, { recursive: true });
  const path = resolve(runDirectory, `run-${manifest.runId}.json`);
  await writeFile(path, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  return { path, manifest };
}

export async function savePostsRunManifest(path, manifest) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.equal(resolve(path).startsWith(`${runDirectory}${sep}`), true);
  assert.equal(basename(path), `run-${manifest.runId}.json`);
  const contents = JSON.stringify(manifest);
  const previousSave = manifestSaveQueues.get(path) ?? Promise.resolve();
  const save = previousSave.catch(() => undefined).then(async () => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  });
  manifestSaveQueues.set(path, save);
  try {
    await save;
  } finally {
    if (manifestSaveQueues.get(path) === save) manifestSaveQueues.delete(path);
  }
}

export async function removePostsRunManifest(path, manifest) {
  validatePostsRunManifest(manifest, manifest.databaseId);
  assert.equal(resolve(path).startsWith(`${runDirectory}${sep}`), true);
  assert.equal(basename(path), `run-${manifest.runId}.json`);
  assert.equal(manifest.finishedAt !== null && Object.values(manifest.cleanup).every(Boolean), true,
    'Retain ownership manifests unless exact cleanup and baseline restoration are verified.');
  await rm(path);
}

function assertValidBaseline(baseline) {
  assert.deepEqual(Object.keys(baseline).sort(), ['counts', 'dataFingerprint']);
  assert.match(baseline.dataFingerprint, fingerprintPattern);
  assert.deepEqual(Object.keys(baseline.counts).sort(), [
    'authEvents', 'authored', 'friendships', 'pairs', 'posts', 'sessions', 'users',
  ]);
  assert.ok(Object.values(baseline.counts).every((count) => Number.isSafeInteger(count) && count >= 0));
}

function assertUuidList(values) {
  assert.ok(Array.isArray(values));
  assert.ok(values.every((value) => typeof value === 'string' && uuidPattern.test(value)));
  assert.equal(new Set(values).size, values.length);
}

function canonical(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value === 'object' && typeof value.toString === 'function' &&
      value.constructor?.name === 'DateTime') return value.toString();
  return value;
}
