import neo4j from 'neo4j-driver';
import { migrationDefinitions, checksumMigration, profileUserIdPreflight } from '../dist/neo4j/neo4j-migrations.js';

const database = process.argv[2];
const mode = process.argv[3] ?? 'preflight';
if (!['isn-dev', 'isn-test'].includes(database) || !['preflight', 'post'].includes(mode)) {
  throw new Error('Usage: profile-migration-preflight.mjs <isn-dev|isn-test> [preflight|post]');
}
if (process.env.NEO4J_DATABASE !== database) {
  throw new Error('Configured Neo4j database does not match the requested target');
}
if (database === 'isn-test' && (process.env.NEO4J_USERNAME || process.env.NEO4J_PASSWORD)) {
  throw new Error('Test preflight refuses development administrator credentials');
}
const uri = process.env.NEO4J_URI;
const username = database === 'isn-test' ? process.env.NEO4J_TEST_USERNAME : process.env.NEO4J_USERNAME;
const password = database === 'isn-test' ? process.env.NEO4J_TEST_PASSWORD : process.env.NEO4J_PASSWORD;
if (!uri || !username || !password) throw new Error('Target Neo4j credentials are unavailable');

const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
const expectedVersion = mode === 'preflight' ? 2 : 3;
const expectedMigrations = migrationDefinitions.filter(({ version }) => version <= expectedVersion);
const expectedConstraints = [
  ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'ISNSchema', 'key'],
  ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'ISNSchemaMigration', 'version'],
  ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'User', 'id'],
  ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'User', 'email'],
  ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'AuthSession', 'id'],
  ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'AuthSession', 'jti'],
  ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'AuthActivityEvent', 'eventId'],
];
const expectedIndexes = [
  ['isn_auth_session_expires_at', 'RANGE', 'AuthSession', 'expiresAt'],
  ['isn_auth_event_timestamp', 'RANGE', 'AuthActivityEvent', 'timestamp'],
  ...(mode === 'post' ? [['isn_user_display_name_search', 'TEXT', 'User', 'displayNameSearch']] : []),
];

try {
  await driver.verifyConnectivity();
  const session = driver.session({ database });
  let summary;
  try {
    const identity = await session.run('CALL db.info() YIELD name RETURN name');
    if (identity.records[0]?.get('name') !== database) throw new Error('Authenticated database identity mismatch');
    const currentUser = await session.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
    const principal = currentUser.records[0];
    if (database === 'isn-test') {
      if (principal?.get('username') !== 'isn_test_runner' ||
          JSON.stringify([...principal.get('roles')].sort()) !== JSON.stringify(['PUBLIC', 'isn_test_runner_role'])) {
        throw new Error('Restricted test identity or role assignments do not match the approved policy');
      }
      const dev = driver.session({ database: 'isn-dev' });
      try {
        await dev.run('CALL db.ping()');
        throw new Error('Restricted test identity unexpectedly accessed isn-dev');
      } catch (error) {
        if (error.message === 'Restricted test identity unexpectedly accessed isn-dev' ||
            !String(error?.code ?? '').startsWith('Neo.ClientError.Security.')) throw error;
      } finally {
        await dev.close();
      }
    }

    const historyResult = await session.run(
      `MATCH (migration:ISNSchemaMigration)
       RETURN migration.version AS version, migration.name AS name,
              migration.checksum AS checksum, migration.status AS status,
              migration.appliedAt IS NOT NULL AS hasAppliedAt,
              migration.verifiedAt IS NOT NULL AS hasVerifiedAt ORDER BY version`,
    );
    const history = historyResult.records.map((record) => ({
      version: asNumber(record.get('version')),
      name: String(record.get('name')),
      checksum: String(record.get('checksum')),
      status: String(record.get('status')),
      hasAppliedAt: record.get('hasAppliedAt'),
      hasVerifiedAt: record.get('hasVerifiedAt'),
    }));
    if (history.length !== expectedMigrations.length || history.some((record, index) => {
      const expected = expectedMigrations[index];
      return record.version !== expected.version || record.name !== expected.name ||
        record.checksum !== checksumMigration(expected) || record.status !== 'VERIFIED' ||
        !record.hasAppliedAt || !record.hasVerifiedAt;
    })) throw new Error('Migration history is not exactly the expected verified baseline');

    const marker = await session.run(
      "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
    );
    if (asNumber(marker.records[0]?.get('version')) !== expectedVersion) {
      throw new Error('Application schema marker does not match the expected migration baseline');
    }

    const constraints = await session.run(
      'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
    );
    for (const [name, type, label, property] of expectedConstraints) {
      const actual = constraints.records.find((record) => record.get('name') === name);
      if (!actual || actual.get('type') !== type || actual.get('entityType') !== 'NODE' ||
          JSON.stringify(actual.get('labelsOrTypes')) !== JSON.stringify([label]) ||
          JSON.stringify(actual.get('properties')) !== JSON.stringify([property])) {
        throw new Error(`Expected schema constraint ${name} is missing or inconsistent`);
      }
    }

    const indexes = await session.run(
      'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
    );
    for (const [name, type, label, property] of expectedIndexes) {
      const actual = indexes.records.find((record) => record.get('name') === name);
      if (!actual || actual.get('type') !== type || actual.get('entityType') !== 'NODE' ||
          JSON.stringify(actual.get('labelsOrTypes')) !== JSON.stringify([label]) ||
          JSON.stringify(actual.get('properties')) !== JSON.stringify([property]) ||
          actual.get('state') !== 'ONLINE') {
        throw new Error(`Expected schema index ${name} is missing, inconsistent, or not ONLINE`);
      }
    }

    const profileState = await session.run(
      `MATCH (user:User)
       WHERE ${mode === 'preflight'
         ? '(user.displayName IS NOT NULL OR user.bio IS NOT NULL OR user.location IS NOT NULL OR user.profileCreatedAt IS NOT NULL OR user.profileUpdatedAt IS NOT NULL OR user.profileVersion IS NOT NULL OR user.displayNameSearch IS NOT NULL)'
         : '(user.displayName IS NULL OR user.displayNameSearch IS NULL OR user.profileCreatedAt IS NULL OR user.profileUpdatedAt IS NULL OR user.profileVersion IS NULL OR user.profileVersion < 0)'}
       RETURN count(user) AS affected`,
    );
    const affectedProfiles = asNumber(profileState.records[0]?.get('affected'));
    if (affectedProfiles !== 0) {
      throw new Error(mode === 'preflight'
        ? 'Existing profile properties require review; no database write is authorized'
        : 'One or more users do not satisfy the V3 profile invariants');
    }

    const invalidUserIds = await session.run(profileUserIdPreflight);
    if (asNumber(invalidUserIds.records[0]?.get('invalidUserIds')) !== 0) {
      throw new Error('Every existing User must have a UUID ID before V3 migration or acceptance');
    }

    const counts = await session.run(
      `CALL { MATCH (user:User) RETURN count(user) AS users }
       CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
       CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
       RETURN users, sessions, events`,
    );
    const countRecord = counts.records[0];
    summary = {
      database,
      username: principal?.get('username'),
      roles: principal ? [...principal.get('roles')].sort() : [],
      schemaVersion: expectedVersion,
      migrations: history.map(({ version, name, checksum, status }) => ({ version, name, checksum, status })),
      indexes: expectedIndexes.map(([name]) => ({
        name,
        state: indexes.records.find((record) => record.get('name') === name)?.get('state'),
      })),
      profileRowsChecked: affectedProfiles,
      authenticationCounts: {
        users: asNumber(countRecord.get('users')),
        sessions: asNumber(countRecord.get('sessions')),
        events: asNumber(countRecord.get('events')),
      },
      result: mode === 'preflight' ? 'SAFE_TO_MIGRATE_IF_APPLICATION_WRITES_ARE_QUIESCENT' : 'POST_MIGRATION_VERIFIED',
    };
  } finally {
    await session.close();
  }
  console.log(JSON.stringify(summary));
} finally {
  await driver.close();
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return NaN;
}
