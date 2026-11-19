import assert from 'node:assert/strict';
import { test } from 'node:test';

test('read-only profile acceptance preflight verifies restricted isn-test V5 readiness', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD);
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD);

  const neo4j = await import('neo4j-driver');
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );

  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database: 'isn-test' });
    try {
      const identity = await session.run('CALL db.info() YIELD name, id RETURN name, id');
      const principal = await session.run(
        'CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles',
      );
      assert.equal(identity.records[0]?.get('name'), 'isn-test');
      assert.equal(typeof identity.records[0]?.get('id'), 'string');
      assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
      assert.deepEqual([...principal.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);

      const expectedMigrations = [
        [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
        [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
        [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
        [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2'],
        [5, 'posts-feed', '48613d31278476128f0d904ad40c76c21c68d61d20b2b3fa526f423de63be523'],
      ];
      const history = await session.run(
        `MATCH (migration:ISNSchemaMigration)
         RETURN migration.version AS version, migration.name AS name,
                migration.checksum AS checksum, migration.status AS status,
                migration.appliedAt IS NOT NULL AS applied,
                migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
      );
      assert.deepEqual(history.records.map((record) => [
        asNumber(record.get('version')), record.get('name'), record.get('checksum'),
        record.get('status'), record.get('applied'), record.get('verified'),
      ]), expectedMigrations.map(([version, name, checksum]) => [version, name, checksum, 'VERIFIED', true, true]));

      const marker = await session.run(
        "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
      );
       assert.equal(asNumber(marker.records[0]?.get('version')), 5);

      const expectedConstraints = [
        ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchema', 'key'],
        ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchemaMigration', 'version'],
        ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', 'id'],
        ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', 'email'],
        ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', 'id'],
        ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', 'jti'],
        ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthActivityEvent', 'eventId'],
        ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', 'pairKey'],
        ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', 'requestId'],
        ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', 'id'],
        ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', 'pairKey'],
        ['isn_post_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'Post', 'id'],
      ];
      const constraints = await session.run(
       'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
      );
      assert.equal(constraints.records.length, expectedConstraints.length, 'Constraint catalog must match V1–V5 exactly');
      for (const [name, type, entityType, label, property] of expectedConstraints) {
        assert.ok(constraints.records.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === entityType &&
          JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
          JSON.stringify(record.get('properties')) === JSON.stringify([property])),
        `Expected constraint ${name} must match the approved catalog`);
      }

      const expectedIndexes = [
        ['isn_auth_event_id', 'RANGE', 'AuthActivityEvent', 'eventId'],
        ['isn_auth_session_id', 'RANGE', 'AuthSession', 'id'],
        ['isn_auth_session_jti', 'RANGE', 'AuthSession', 'jti'],
        ['isn_auth_session_expires_at', 'RANGE', 'AuthSession', 'expiresAt'],
        ['isn_auth_event_timestamp', 'RANGE', 'AuthActivityEvent', 'timestamp'],
        ['isn_schema_metadata_key', 'RANGE', 'ISNSchema', 'key'],
        ['isn_schema_migration_version', 'RANGE', 'ISNSchemaMigration', 'version'],
        ['isn_user_email', 'RANGE', 'User', 'email'],
        ['isn_user_id', 'RANGE', 'User', 'id'],
        ['isn_user_display_name_search', 'TEXT', 'User', 'displayNameSearch'],
        ['isn_friendship_pair_key', 'RANGE', 'FriendshipPair', 'pairKey'],
        ['isn_friendship_request_id', 'RANGE', 'FriendshipPair', 'requestId'],
        ['isn_friendship_id', 'RANGE', 'FRIEND_WITH', 'id'],
        ['isn_friendship_edge_pair_key', 'RANGE', 'FRIEND_WITH', 'pairKey'],
        ['isn_friendship_requests_sent', 'RANGE', 'FriendshipPair', ['senderId', 'requestStatus', 'requestId']],
        ['isn_friendship_requests_received', 'RANGE', 'FriendshipPair', ['recipientId', 'requestStatus', 'requestId']],
        ['isn_post_id', 'RANGE', 'Post', ['id']],
        ['isn_post_author_chronology', 'RANGE', 'Post', ['authorId', 'createdAt', 'id']],
      ];
      const indexes = await session.run(
        'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
      );
      const applicationIndexes = indexes.records.filter((record) => record.get('type') !== 'LOOKUP');
      assert.equal(applicationIndexes.length, expectedIndexes.length, 'Application index catalog must match V2–V5 exactly');
      for (const [name, type, label, property] of expectedIndexes) {
        assert.ok(applicationIndexes.some((record) => record.get('name') === name &&
          record.get('type') === type && record.get('entityType') === (label === 'FRIEND_WITH' ? 'RELATIONSHIP' : 'NODE') &&
          JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
          JSON.stringify(record.get('properties')) === JSON.stringify(Array.isArray(property) ? property : [property]) &&
          record.get('state') === 'ONLINE'),
        `Expected index ${name} must match the approved catalog and be ONLINE`);
      }

      const profileInvariant = await session.run(
        `MATCH (user:User)
         WHERE user.id IS NULL OR user.displayName IS NULL OR size(user.displayName) < 2 OR size(user.displayName) > 80 OR
               user.displayNameSearch IS NULL OR user.profileCreatedAt IS NULL OR user.profileUpdatedAt IS NULL OR
               user.profileVersion IS NULL OR user.profileVersion < 0
         RETURN count(user) AS invalidProfiles`,
      );
      assert.equal(asNumber(profileInvariant.records[0]?.get('invalidProfiles')), 0);

      const baseline = await session.run(
        `CALL { MATCH (user:User) RETURN count(user) AS users }
         CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
         CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
         RETURN users, sessions, events`,
      );
      const counts = baseline.records[0];
      assert.ok(counts);

      console.log(JSON.stringify({
        scenario: 'UPD-00-read-only-preflight',
        database: 'isn-test',
        databaseIdVerified: true,
        principal: 'isn_test_runner',
        rolesVerified: true,
        migrationsVerified: 5,
        schemaVersion: 5,
        constraintsVerified: expectedConstraints.length,
        indexesVerified: expectedIndexes.length,
        profileInvariant: 'valid',
        baseline: {
          users: asNumber(counts.get('users')),
          sessions: asNumber(counts.get('sessions')),
          authEvents: asNumber(counts.get('events')),
        },
        writesPerformed: false,
      }));
    } finally {
      await session.close();
    }

    const dev = driver.session({ database: 'isn-dev' });
    try {
      await assert.rejects(dev.run('CALL db.ping()'), (error) =>
        /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    } finally {
      await dev.close();
    }
  } finally {
    await driver.close();
  }
});

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
