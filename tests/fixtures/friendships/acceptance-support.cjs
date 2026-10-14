const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, rm, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const DATABASE_ID = '336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786';
const APPROVED_BASE_COMMIT = '24181d9d9af24506fe2194fe7b4eef566e166d98';
const MIGRATIONS = [
  [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
  [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
  [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
  [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2'],
];

const constraints = [
  ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchema', ['key']],
  ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchemaMigration', ['version']],
  ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['id']],
  ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['email']],
  ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['id']],
  ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['jti']],
  ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthActivityEvent', ['eventId']],
  ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['pairKey']],
  ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['requestId']],
  ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
  ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
];

const indexes = [
  ['isn_auth_event_id', 'RANGE', 'NODE', 'AuthActivityEvent', ['eventId']],
  ['isn_auth_session_id', 'RANGE', 'NODE', 'AuthSession', ['id']],
  ['isn_auth_session_jti', 'RANGE', 'NODE', 'AuthSession', ['jti']],
  ['isn_auth_session_expires_at', 'RANGE', 'NODE', 'AuthSession', ['expiresAt']],
  ['isn_auth_event_timestamp', 'RANGE', 'NODE', 'AuthActivityEvent', ['timestamp']],
  ['isn_schema_metadata_key', 'RANGE', 'NODE', 'ISNSchema', ['key']],
  ['isn_schema_migration_version', 'RANGE', 'NODE', 'ISNSchemaMigration', ['version']],
  ['isn_user_email', 'RANGE', 'NODE', 'User', ['email']],
  ['isn_user_id', 'RANGE', 'NODE', 'User', ['id']],
  ['isn_user_display_name_search', 'TEXT', 'NODE', 'User', ['displayNameSearch']],
  ['isn_friendship_pair_key', 'RANGE', 'NODE', 'FriendshipPair', ['pairKey']],
  ['isn_friendship_request_id', 'RANGE', 'NODE', 'FriendshipPair', ['requestId']],
  ['isn_friendship_id', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
  ['isn_friendship_edge_pair_key', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
  ['isn_friendship_requests_sent', 'RANGE', 'NODE', 'FriendshipPair', ['senderId', 'requestStatus', 'requestId']],
  ['isn_friendship_requests_received', 'RANGE', 'NODE', 'FriendshipPair', ['recipientId', 'requestStatus', 'requestId']],
];

function assertTestEnvironment() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD);
  assert.equal(process.env.NEO4J_USERNAME || '', '');
  assert.equal(process.env.NEO4J_PASSWORD || '', '');
  const root = resolve(__dirname, '../../..');
  assert.equal(normalizePath(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()), normalizePath(root));
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'feature/friendship-system');
  assert.doesNotThrow(() => execFileSync('git', ['merge-base', '--is-ancestor', APPROVED_BASE_COMMIT, 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  }), `HEAD must descend from the approved Friendship base ${APPROVED_BASE_COMMIT}`);
  return root;
}

async function verifyCurrentV4(session, expectedDatabaseId = DATABASE_ID) {
  const identity = await session.run('CALL db.info() YIELD name,id RETURN name,id');
  assert.equal(identity.records[0]?.get('name'), 'isn-test');
  assert.equal(identity.records[0]?.get('id'), expectedDatabaseId);
  const user = await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
  assert.equal(user.records[0]?.get('username'), 'isn_test_runner');
  assert.deepEqual([...user.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);

  const history = await session.run(
    `MATCH (migration:ISNSchemaMigration)
     RETURN migration.version AS version,migration.name AS name,migration.checksum AS checksum,
            migration.status AS status,migration.appliedAt IS NOT NULL AS applied,
            migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
  );
  assert.deepEqual(history.records.map((record) => [
    countAsNumber(record.get('version')), record.get('name'), record.get('checksum'),
    record.get('status'), record.get('applied'), record.get('verified'),
  ]), MIGRATIONS.map(([version, name, checksum]) => [version, name, checksum, 'VERIFIED', true, true]));
  const marker = await session.run("MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version");
  assert.equal(countAsNumber(marker.records[0]?.get('version')), 4);

  const actualConstraints = await session.run(
    'SHOW CONSTRAINTS YIELD name,type,entityType,labelsOrTypes,properties RETURN name,type,entityType,labelsOrTypes,properties',
  );
  assert.equal(actualConstraints.records.length, constraints.length);
  for (const [name, type, entityType, label, properties] of constraints) {
    assert.ok(actualConstraints.records.some((record) => record.get('name') === name && record.get('type') === type &&
      record.get('entityType') === entityType && JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
      JSON.stringify(record.get('properties')) === JSON.stringify(properties)), `Constraint ${name} does not match V4 catalog`);
  }

  const actualIndexes = await session.run(
    'SHOW INDEXES YIELD name,type,entityType,labelsOrTypes,properties,state RETURN name,type,entityType,labelsOrTypes,properties,state',
  );
  const appIndexes = actualIndexes.records.filter((record) => record.get('type') !== 'LOOKUP');
  assert.equal(appIndexes.length, indexes.length);
  for (const [name, type, entityType, label, properties] of indexes) {
    assert.ok(appIndexes.some((record) => record.get('name') === name && record.get('type') === type &&
      record.get('entityType') === entityType && JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
      JSON.stringify(record.get('properties')) === JSON.stringify(properties) && record.get('state') === 'ONLINE'),
    `Index ${name} is missing or not ONLINE`);
  }

  const invalidProfiles = await session.run(
    `MATCH (user:User)
     WHERE user.id IS NULL OR user.displayName IS NULL OR size(user.displayName)<2 OR size(user.displayName)>80 OR
           user.displayNameSearch IS NULL OR user.profileCreatedAt IS NULL OR user.profileUpdatedAt IS NULL OR
           user.profileVersion IS NULL OR user.profileVersion<0 RETURN count(user) AS count`,
  );
  assert.equal(countAsNumber(invalidProfiles.records[0]?.get('count')), 0);
  await assertGraphInvariants(session);
  return { databaseId: expectedDatabaseId, username: 'isn_test_runner', roles: ['PUBLIC', 'isn_test_runner_role'] };
}

async function assertGraphInvariants(session) {
  const invalidPairs = await session.run(
    `MATCH (pair:FriendshipPair)
     WHERE pair.lowUserId IS NULL OR pair.highUserId IS NULL OR pair.lowUserId >= pair.highUserId OR
           pair.pairKey <> pair.lowUserId + ':' + pair.highUserId OR
           NOT EXISTS { MATCH (:User {id:pair.lowUserId}) } OR NOT EXISTS { MATCH (:User {id:pair.highUserId}) } OR
           pair.version IS NULL OR pair.version<0 OR pair.requestedAt IS NULL OR
           pair.requestStatus IS NULL OR pair.requestId IS NULL OR pair.senderId IS NULL OR pair.recipientId IS NULL OR
           pair.senderId = pair.recipientId OR NOT pair.senderId IN [pair.lowUserId,pair.highUserId] OR
           NOT pair.recipientId IN [pair.lowUserId,pair.highUserId] OR
           (pair.requestStatus = 'PENDING' AND (pair.friendshipId IS NOT NULL OR pair.friendsSince IS NOT NULL)) OR
           (pair.requestStatus = 'ACCEPTED' AND ((pair.friendshipId IS NULL) <> (pair.friendsSince IS NULL) OR pair.resolvedAt IS NULL)) OR
           (pair.requestStatus IN ['REJECTED','CANCELLED'] AND (pair.friendshipId IS NOT NULL OR pair.friendsSince IS NOT NULL)) OR
           NOT pair.requestStatus IN ['PENDING','ACCEPTED','REJECTED','CANCELLED']
     RETURN count(pair) AS count`,
  );
  assert.equal(countAsNumber(invalidPairs.records[0]?.get('count')), 0, 'Canonical pair/lifecycle invariant failed');
  const invalidEdges = await session.run(
    `MATCH (low:User)-[edge:FRIEND_WITH]->(high:User)
     OPTIONAL MATCH (pair:FriendshipPair {pairKey:edge.pairKey})
     WITH low,edge,high,pair
     WHERE pair IS NULL OR pair.requestStatus <> 'ACCEPTED' OR pair.friendshipId <> edge.id OR
           pair.lowUserId <> low.id OR pair.highUserId <> high.id OR pair.friendsSince <> edge.since
     RETURN count(edge) AS count`,
  );
  assert.equal(countAsNumber(invalidEdges.records[0]?.get('count')), 0, 'Orphan or mismatched FRIEND_WITH relationship found');
  const acceptedWithoutOneEdge = await session.run(
    `MATCH (pair:FriendshipPair) WHERE pair.requestStatus='ACCEPTED' AND pair.friendshipId IS NOT NULL
     OPTIONAL MATCH (:User {id:pair.lowUserId})-[edge:FRIEND_WITH {pairKey:pair.pairKey}]->(:User {id:pair.highUserId})
     WITH pair,count(DISTINCT edge) AS edges WHERE edges <> 1 RETURN count(pair) AS count`,
  );
  assert.equal(countAsNumber(acceptedWithoutOneEdge.records[0]?.get('count')), 0);
}

async function captureBaseline(session) {
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
    events: `MATCH (e:AuthActivityEvent) OPTIONAL MATCH (user:User)-[:PERFORMED_AUTH_EVENT]->(e)
      RETURN e.eventId AS id,e.userId AS userId,e.sessionId AS sessionId,
      e.eventType AS eventType,e.schemaVersion AS schemaVersion,toString(e.timestamp) AS timestamp,e.source AS source,
      collect(DISTINCT user.id) AS userIds ORDER BY id`,
    pairs: `MATCH (p:FriendshipPair) RETURN p.pairKey AS pairKey,p.lowUserId AS lowUserId,p.highUserId AS highUserId,
      p.version AS version,p.requestId AS requestId,p.senderId AS senderId,p.recipientId AS recipientId,
      p.requestStatus AS requestStatus,toString(p.requestedAt) AS requestedAt,toString(p.resolvedAt) AS resolvedAt,
      p.friendshipId AS friendshipId,toString(p.friendsSince) AS friendsSince ORDER BY pairKey`,
    edges: `MATCH (low:User)-[e:FRIEND_WITH]->(high:User) RETURN low.id AS lowUserId,high.id AS highUserId,
      e.id AS id,e.pairKey AS pairKey,toString(e.since) AS since ORDER BY pairKey`,
  };
  const data = {};
  for (const [name, query] of Object.entries(queries)) {
    const result = await session.run(query);
    data[name] = result.records.map((record) => Object.fromEntries(record.keys.map((key) => [key, canonical(record.get(key))])));
  }
  const migrations = await session.run(
    `MATCH (migration:ISNSchemaMigration)
     RETURN migration.version AS version,migration.name AS name,migration.checksum AS checksum,
       migration.status AS status,toString(migration.appliedAt) AS appliedAt,
       toString(migration.verifiedAt) AS verifiedAt ORDER BY version`,
  );
  const schema = await session.run(
    "MATCH (marker:ISNSchema {key:'application'}) RETURN marker.version AS version",
  );
  const catalog = {
    applicationVersion: countAsNumber(schema.records[0]?.get('version')),
    migrations: migrations.records.map((record) => Object.fromEntries(record.keys.map((key) => [key, canonical(record.get(key))]))),
  };
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  return {
    counts: { users: counts.users, sessions: counts.sessions, authEvents: counts.events, pairs: counts.pairs, friendships: counts.edges },
    fingerprint: createHash('sha256').update(JSON.stringify({ data, catalog })).digest('hex'),
    catalogFingerprint: digest(catalog),
    migrationVersions: catalog.migrations.map((migration) => migration.version),
  };
}

async function writeRunManifest(baseline) {
  const directory = resolve('.artifacts/weylume/friendship-acceptance');
  await mkdir(directory, { recursive: true });
  const runId = randomUUID();
  const path = resolve(directory, `run-${runId}.json`);
  const manifest = {
    version: 1, runId, pid: process.pid, database: 'isn-test', databaseId: DATABASE_ID,
    startedAt: new Date().toISOString(), baseline, fixtures: [], pairs: [], sessionIds: [], authEventIds: [],
    cleanup: { pairsRemoved: false, accountsRemoved: false, baselineRestored: false },
  };
  await writeFile(path, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  return { path, manifest };
}

async function saveRunManifest(path, manifest) {
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
}

async function reserveRunFixture(path, manifest, email, userId) {
  assert.match(email, /^profile-[0-9a-f-]{36}@example\.invalid$/iu);
  if (userId !== undefined) assert.match(userId, /^[0-9a-f-]{36}$/iu);
  const { recordFixtureOwnership } = await import('../../integration/neo4j/fixture-ownership.mjs');
  const accountManifest = await recordFixtureOwnership(email, userId);
  manifest.fixtures.push({ email, ...(userId ? { userId } : {}), accountManifest, sessionIds: [], authEventIds: [], pairKeys: [], requestIds: [], friendshipIds: [] });
  await saveRunManifest(path, manifest);
  return manifest.fixtures.at(-1);
}

async function reserveRunPair(path, manifest, firstUserId, secondUserId) {
  assert.notEqual(firstUserId, secondUserId);
  const lowUserId = firstUserId < secondUserId ? firstUserId : secondUserId;
  const highUserId = firstUserId < secondUserId ? secondUserId : firstUserId;
  const pairKey = `${lowUserId}:${highUserId}`;
  let pair = manifest.pairs.find((item) => item.pairKey === pairKey);
  if (!pair) {
    pair = { pairKey, lowUserId, highUserId, requestIds: [], friendshipIds: [], relationships: [] };
    manifest.pairs.push(pair);
    for (const fixture of manifest.fixtures) {
      if (fixture.userId === lowUserId || fixture.userId === highUserId) fixture.pairKeys.push(pairKey);
    }
    await saveRunManifest(path, manifest);
  }
  return pair;
}

async function recordRunRequest(path, manifest, pairKey, requestId) {
  const pair = manifest.pairs.find((item) => item.pairKey === pairKey);
  assert.ok(pair, 'Pair ownership must be recorded before a request is issued');
  assert.match(requestId, /^[0-9a-f-]{36}$/iu);
  if (!pair.requestIds.includes(requestId)) pair.requestIds.push(requestId);
  await saveRunManifest(path, manifest);
}

async function recordRunFriendship(path, manifest, pairKey, friendshipId) {
  const pair = manifest.pairs.find((item) => item.pairKey === pairKey);
  assert.ok(pair, 'Pair ownership must be recorded before a friendship is accepted');
  assert.match(friendshipId, /^[0-9a-f-]{36}$/iu);
  if (!pair.friendshipIds.includes(friendshipId)) pair.friendshipIds.push(friendshipId);
  if (!pair.relationships.some((relationship) => relationship.id === friendshipId)) {
    pair.relationships.push({
      id: friendshipId,
      pairKey,
      lowUserId: pair.lowUserId,
      highUserId: pair.highUserId,
      direction: 'low-to-high',
    });
  }
  await saveRunManifest(path, manifest);
}

async function registerOwnedFixture(session, manifest, path, email, userId) {
  assert.match(email, /^profile-[0-9a-f-]{36}@example\.invalid$/iu);
  assert.match(userId, /^[0-9a-f-]{36}$/iu);
  const existing = await session.run('MATCH (u:User) WHERE u.id=$id OR u.email=$email RETURN u.id AS id,u.email AS email', { id: userId, email });
  assert.equal(existing.records.length, 1);
  assert.deepEqual([existing.records[0].get('id'), existing.records[0].get('email')], [userId, email]);
  const auth = await session.run(
    `MATCH (u:User {id:$id,email:$email})
     OPTIONAL MATCH (u)-[:HAS_AUTH_SESSION]->(s:AuthSession)
     WITH u,collect(DISTINCT s.id) AS sessions
     OPTIONAL MATCH (u)-[:PERFORMED_AUTH_EVENT]->(e:AuthActivityEvent)
     RETURN sessions,collect(DISTINCT e.eventId) AS events`, { id: userId, email },
  );
  const record = auth.records[0];
  const fixture = manifest.fixtures.find((item) => item.email === email);
  assert.ok(fixture, 'Durable run ownership must be reserved before registering the account');
  fixture.userId = userId;
  fixture.sessionIds = record.get('sessions').filter(Boolean);
  fixture.authEventIds = record.get('events').filter(Boolean);
  const { updateFixtureOwnership } = await import('../../integration/neo4j/fixture-ownership.mjs');
  await updateFixtureOwnership(fixture.accountManifest, email, userId);
  manifest.sessionIds.push(...fixture.sessionIds);
  manifest.authEventIds.push(...fixture.authEventIds);
  await saveRunManifest(path, manifest);
  return fixture;
}

async function refreshOwnedAuthRecords(session, manifest, path, fixture) {
  const result = await session.run(
    `MATCH (user:User {id:$id,email:$email})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(session:AuthSession)
     WITH user,collect(DISTINCT session.id) AS sessions
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN sessions,collect(DISTINCT event.eventId) AS events`,
    { id: fixture.userId, email: fixture.email },
  );
  assert.equal(result.records.length, 1);
  fixture.sessionIds = result.records[0].get('sessions').filter(Boolean);
  fixture.authEventIds = result.records[0].get('events').filter(Boolean);
  manifest.sessionIds = [...new Set(manifest.fixtures.flatMap((item) => item.sessionIds))];
  manifest.authEventIds = [...new Set(manifest.fixtures.flatMap((item) => item.authEventIds))];
  await saveRunManifest(path, manifest);
}

async function cleanupRun(driver, path, manifest, expectedBaseline) {
  const { removeFixtureManifest, removeOwnedFixture } = await import('../../integration/neo4j/fixture-ownership.mjs');
  const session = driver.session({ database: 'isn-test' });
  try {
    const userIds = manifest.fixtures.map((fixture) => fixture.userId).filter(Boolean);
    for (const fixture of manifest.fixtures.filter((item) => !item.userId)) {
      const untracked = await session.run('MATCH (user:User {email:$email}) RETURN count(user) AS count', { email: fixture.email });
      assert.equal(countAsNumber(untracked.records[0]?.get('count')), 0,
        'A registered user exists without a durable user ID in the run manifest; cleanup stopped');
    }
    const pairRows = await session.run(
      `MATCH (pair:FriendshipPair) WHERE pair.lowUserId IN $ids OR pair.highUserId IN $ids
       RETURN pair.pairKey AS pairKey,pair.lowUserId AS low,pair.highUserId AS high,
         pair.requestId AS requestId,pair.senderId AS senderId,pair.recipientId AS recipientId,
         pair.requestStatus AS status,pair.friendshipId AS friendshipId`, { ids: userIds },
    );
    for (const row of pairRows.records) {
      const key = row.get('pairKey');
      const ownedPair = manifest.pairs.find((pair) => pair.pairKey === key);
      assert.ok(ownedPair, 'Unexpected pair involving an owned user; cleanup stopped');
      assert.equal(row.get('low'), ownedPair.lowUserId);
      assert.equal(row.get('high'), ownedPair.highUserId);
      assert.ok(userIds.includes(row.get('low')) && userIds.includes(row.get('high')));
      assert.equal(key, `${row.get('low')}:${row.get('high')}`);
      assert.ok(ownedPair.requestIds.includes(row.get('requestId')), 'Current request lifecycle is not in the run manifest');
      assert.ok(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(row.get('status')));
      assert.ok([row.get('low'), row.get('high')].includes(row.get('senderId')));
      assert.ok([row.get('low'), row.get('high')].includes(row.get('recipientId')));
      if (row.get('friendshipId')) assert.ok(ownedPair.friendshipIds.includes(row.get('friendshipId')));
    }
    const edges = await session.run(
      `MATCH (low:User)-[edge:FRIEND_WITH]->(high:User)
       WHERE low.id IN $ids OR high.id IN $ids
       RETURN edge.id AS id,edge.pairKey AS pairKey,low.id AS low,high.id AS high,
         edge.since AS since`, { ids: userIds },
    );
    for (const row of edges.records) {
      const pair = manifest.pairs.find((item) => item.pairKey === row.get('pairKey'));
      assert.ok(pair, 'Unexpected FRIEND_WITH edge involving an owned user; cleanup stopped');
      assert.ok(pair.friendshipIds.includes(row.get('id')));
      assert.ok(pair.relationships.some((relationship) => relationship.id === row.get('id') &&
        relationship.pairKey === row.get('pairKey') && relationship.lowUserId === row.get('low') &&
        relationship.highUserId === row.get('high') && relationship.direction === 'low-to-high'),
      'Relationship ID, canonical pair key, direction or endpoints are not in the manifest');
      assert.ok(userIds.includes(row.get('low')) && userIds.includes(row.get('high')));
      assert.equal(row.get('low'), pair.lowUserId);
      assert.equal(row.get('high'), pair.highUserId);
      assert.equal(row.get('pairKey'), `${row.get('low')}:${row.get('high')}`);
      pair.relationships.push({ id: row.get('id'), lowUserId: row.get('low'), highUserId: row.get('high'), since: canonical(row.get('since')) });
    }
    await session.executeWrite(async (tx) => {
      for (const pair of manifest.pairs) {
        const current = await tx.run(
          `MATCH (node:FriendshipPair {pairKey:$key,lowUserId:$low,highUserId:$high})
           RETURN node.requestId AS requestId,node.friendshipId AS friendshipId`,
          { low: pair.lowUserId, high: pair.highUserId, key: pair.pairKey },
        );
        if (current.records.length === 0) continue;
        assert.equal(current.records.length, 1);
        assert.ok(pair.requestIds.includes(current.records[0].get('requestId')));
        const currentEdges = await tx.run(
          `MATCH (low:User {id:$low})-[edge:FRIEND_WITH {pairKey:$key}]->(high:User {id:$high})
           RETURN edge.id AS id`,
          { low: pair.lowUserId, high: pair.highUserId, key: pair.pairKey },
        );
        assert.ok(currentEdges.records.every((record) => pair.friendshipIds.includes(record.get('id'))));
        await tx.run(
          `MATCH (low:User {id:$low})-[edge:FRIEND_WITH {pairKey:$key}]->(high:User {id:$high})
           WHERE edge.id IN $ids DELETE edge`,
          { low: pair.lowUserId, high: pair.highUserId, key: pair.pairKey, ids: pair.friendshipIds },
        );
        await tx.run(
          'MATCH (pair:FriendshipPair {pairKey:$key,lowUserId:$low,highUserId:$high}) DELETE pair',
          { key: pair.pairKey, low: pair.lowUserId, high: pair.highUserId },
        );
      }
    });
    manifest.cleanup.pairsRemoved = true;
    await saveRunManifest(path, manifest);
    for (const fixture of [...manifest.fixtures].reverse()) {
      if (!fixture.userId) continue;
      const removed = await removeOwnedFixture(session, fixture.email, fixture.userId);
      if (removed.users === 0) {
        const leftovers = await session.run(
          `MATCH (record)
           WHERE (record:User AND (record.id=$userId OR record.email=$email)) OR
                 (record:AuthSession AND record.id IN $sessionIds) OR
                 (record:AuthActivityEvent AND record.eventId IN $eventIds)
           RETURN count(record) AS count`,
          { userId: fixture.userId, email: fixture.email, sessionIds: fixture.sessionIds, eventIds: fixture.authEventIds },
        );
        assert.equal(countAsNumber(leftovers.records[0]?.get('count')), 0,
          'An absent account may only be treated as already cleaned when all of its exact owned auth records are absent');
      } else {
        assert.equal(removed.users, 1);
        assert.equal(removed.sessions, fixture.sessionIds.length);
        assert.equal(removed.events, fixture.authEventIds.length);
      }
    }
    manifest.cleanup.accountsRemoved = true;
    const remainingOwned = await session.run(
      `MATCH (record) WHERE (record:User AND record.id IN $ids) OR
       (record:AuthSession AND record.id IN $sessions) OR (record:AuthActivityEvent AND record.eventId IN $events) OR
       (record:FriendshipPair AND record.pairKey IN $pairs) OR (record:FRIEND_WITH AND record.pairKey IN $pairs)
       RETURN count(record) AS count`,
      { ids: userIds, sessions: manifest.sessionIds, events: manifest.authEventIds, pairs: manifest.pairs.map((pair) => pair.pairKey) },
    );
    assert.equal(countAsNumber(remainingOwned.records[0]?.get('count')), 0);
    const after = await captureBaseline(session);
    assert.deepEqual(after, expectedBaseline, 'Database entities/fingerprints must exactly match the captured pre-run baseline');
    await verifyCurrentV4(session);
    for (const fixture of manifest.fixtures) await removeFixtureManifest(fixture.accountManifest);
    manifest.cleanup.baselineRestored = true;
    manifest.finishedAt = new Date().toISOString();
    await saveRunManifest(path, manifest);
    await rm(path);
    return after;
  } finally {
    await session.close();
  }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonical(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && typeof value.toString === 'function' &&
      (value.constructor?.name === 'DateTime' || value.constructor?.name === 'Date' || typeof value.toNumber === 'function')) {
    return value.toString();
  }
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  return value;
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
}

function countAsNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}

module.exports = {
  DATABASE_ID,
  MIGRATIONS,
  assertTestEnvironment,
  verifyCurrentV4,
  assertGraphInvariants,
  captureBaseline,
  writeRunManifest,
  saveRunManifest,
  reserveRunFixture,
  reserveRunPair,
  recordRunRequest,
  recordRunFriendship,
  registerOwnedFixture,
  refreshOwnedAuthRecords,
  cleanupRun,
  digest,
};
