import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';

const username = 'isn_test_runner';
const role = 'isn_test_runner_role';
const uri = process.env.NEO4J_URI;
const adminUsername = process.env.NEO4J_USERNAME;
const adminPassword = process.env.NEO4J_PASSWORD;
const credentialsPath = resolve('apps/api/.env.test.local');
const friendshipMigrationChecksum = '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2';
const postsMigrationChecksum = '48613d31278476128f0d904ad40c76c21c68d61d20b2b3fa526f423de63be523';
if (!uri || !adminUsername || !adminPassword) {
  throw new Error('Load the development administrator configuration before provisioning');
}
if (process.env.NEO4J_DATABASE !== 'isn-dev') {
  throw new Error('Provisioning requires the explicitly configured isn-dev administrator context');
}
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
if (!['feature/friendship-system', 'feature/posts-feed'].includes(branch)) {
  throw new Error('Provisioning is restricted to the explicitly approved Friendship or Posts feature worktrees');
}
const uriHost = new URL(uri).hostname;
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(uriHost)) {
  throw new Error('Provisioning is restricted to the approved loopback Neo4j runtime');
}

const expectedPrivileges = [
  'GRANT ACCESS ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'DENY ACCESS ON DATABASE `isn-dev` TO `isn_test_runner_role`',
  'GRANT CREATE CONSTRAINT ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT SHOW CONSTRAINT ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE INDEX ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT SHOW INDEX ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE NEW NODE LABEL ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE NEW RELATIONSHIP TYPE ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE NEW PROPERTY NAME ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {key} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MERGE {version} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MERGE {version} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {name} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {checksum} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {status} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {appliedAt} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {verifiedAt} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP HAS_AUTH_SESSION TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP PERFORMED_AUTH_EVENT TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP HAS_AUTH_SESSION TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP PERFORMED_AUTH_EVENT TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {createdAt} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {expiresAt} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {id} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {jti} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {revokedAt} ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {createdAt} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {displayName} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {displayNameSearch} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {bio} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {location} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {profileCreatedAt} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {profileUpdatedAt} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {profileVersion} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {email} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {id} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {passwordHash} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {updatedAt} ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT MERGE {pairKey} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {pairKey} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {lowUserId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {highUserId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {version} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {requestId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {senderId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {recipientId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {requestStatus} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {requestedAt} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {resolvedAt} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {friendshipId} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {friendsSince} ON GRAPH `isn-test` NODE FriendshipPair TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {id} ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {pairKey} ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {since} ON GRAPH `isn-test` RELATIONSHIP FRIEND_WITH TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {eventId} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {eventType} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {schemaVersion} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {sessionId} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {source} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {timestamp} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {userId} ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE User TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE AuthSession TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE AuthActivityEvent TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP HAS_AUTH_SESSION TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP PERFORMED_AUTH_EVENT TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT MERGE {id} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP AUTHORED TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP AUTHORED TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP AUTHORED TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {authorId} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {content} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {visibility} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {createdAt} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {updatedAt} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {version} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
  'GRANT SET PROPERTY {id} ON GRAPH `isn-test` NODE Post TO `isn_test_runner_role`',
];

const schemaLabels = ['ISNSchema', 'ISNSchemaMigration', 'User', 'AuthSession', 'AuthActivityEvent', 'FriendshipPair', 'Post'];
const schemaRelationshipTypes = ['HAS_AUTH_SESSION', 'PERFORMED_AUTH_EVENT', 'FRIEND_WITH', 'AUTHORED'];
const schemaPropertyNames = [
  'key', 'version', 'name', 'checksum', 'status', 'appliedAt', 'verifiedAt',
  'id', 'email', 'passwordHash', 'createdAt', 'updatedAt', 'displayName', 'displayNameSearch', 'bio', 'location',
  'profileCreatedAt', 'profileUpdatedAt', 'profileVersion', 'jti', 'expiresAt', 'revokedAt',
  'eventId', 'schemaVersion', 'eventType', 'timestamp', 'source', 'userId', 'sessionId',
  'pairKey', 'lowUserId', 'highUserId', 'requestId', 'senderId', 'recipientId', 'requestStatus',
  'requestedAt', 'resolvedAt', 'friendshipId', 'friendsSince', 'since',
  'authorId', 'content', 'visibility',
];

const driver = neo4j.driver(uri, neo4j.auth.basic(adminUsername, adminPassword));
let generatedFile = false;
let userCreated = false;
try {
  await driver.verifyConnectivity();
  const testDatabase = driver.session({ database: 'isn-test' });
  let databaseBaseline;
  let schemaVersion;
  try {
    const identity = await testDatabase.run('CALL db.info() YIELD name, id RETURN name, id');
    if (identity.records[0]?.get('name') !== 'isn-test') {
      throw new Error('Test database identity verification failed; provisioning stopped');
    }
    if (typeof identity.records[0]?.get('id') !== 'string') {
      throw new Error('Test database identity did not include its stable database ID; provisioning stopped');
    }
    const marker = await testDatabase.run(
      "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
    );
    schemaVersion = toNumber(marker.records[0]?.get('version'));
    if (schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5) {
      throw new Error('Provisioning requires a verified V3, V4 or V5 schema; no writes made');
    }
    const history = await testDatabase.run(
      `MATCH (migration:ISNSchemaMigration)
       RETURN migration.version AS version, migration.name AS name, migration.checksum AS checksum,
              migration.status AS status, migration.appliedAt IS NOT NULL AS applied,
              migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
    );
    const expectedHistory = [
      [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
      [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
      [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
      ...(schemaVersion >= 4 ? [[4, 'friendship-system', friendshipMigrationChecksum]] : []),
      ...(schemaVersion === 5 ? [[5, 'posts-feed', postsMigrationChecksum]] : []),
    ];
    const actualHistory = history.records.map((record) => [
      toNumber(record.get('version')), record.get('name'), record.get('checksum'),
      record.get('status'), record.get('applied'), record.get('verified'),
    ]);
    const verifiedHistory = expectedHistory.map(([version, name, checksum]) =>
      [version, name, checksum, 'VERIFIED', true, true]);
    if (JSON.stringify(actualHistory) !== JSON.stringify(verifiedHistory)) {
      throw new Error('Migration history is missing, interrupted, or drifted; provisioning stopped without writes');
    }
    await assertMigrationCatalog(testDatabase, schemaVersion);
    const friendshipObjects = await testDatabase.run(
      `CALL { MATCH (pair:FriendshipPair) RETURN count(pair) AS pairs }
       CALL { MATCH ()-[friendship:FRIEND_WITH]-() RETURN count(friendship) AS edges }
       RETURN pairs, edges`,
    );
    const pairCount = toNumber(friendshipObjects.records[0]?.get('pairs'));
    const edgeCount = toNumber(friendshipObjects.records[0]?.get('edges'));
    if (schemaVersion === 3 && (pairCount !== 0 || edgeCount !== 0)) {
      throw new Error('Unexpected Friendship graph data exists before V4; provisioning stopped without writes');
    }
    if (schemaVersion === 3) await assertNoFriendshipSchemaObjects(testDatabase);
    const postsBeforeV5 = await testDatabase.run(
      `CALL { MATCH (post:Post) RETURN count(post) AS posts }
       CALL { MATCH ()-[authored:AUTHORED]->() RETURN count(authored) AS authored }
       RETURN posts, authored`,
    );
    if (schemaVersion < 5 && (toNumber(postsBeforeV5.records[0]?.get('posts')) !== 0 ||
        toNumber(postsBeforeV5.records[0]?.get('authored')) !== 0)) {
      throw new Error('Unexpected Post graph data exists before V5; provisioning stopped without writes');
    }
    if (schemaVersion < 5) await assertNoPostSchemaObjects(testDatabase);
    databaseBaseline = await readDataCounts(testDatabase);
  } finally {
    await testDatabase.close();
  }
  const system = driver.session({ database: 'system' });
  try {
    const activeTransactions = await system.run(
      `SHOW TRANSACTIONS YIELD database, transactionId
       WHERE database = 'isn-test' RETURN transactionId`,
    );
    if (activeTransactions.records.length !== 0) {
      throw new Error('isn-test has active transactions; wait for an exclusive database write window');
    }
    const dbms = await system.run('CALL dbms.components() YIELD versions, edition RETURN versions[0] AS version, edition');
    const server = dbms.records[0];
    if (server?.get('version') !== '2026.09.0' || server?.get('edition') !== 'enterprise') {
      throw new Error('Unexpected Neo4j server version or edition; provisioning stopped');
    }
    const users = await system.run(
      'SHOW USERS YIELD user, roles, home, suspended WHERE user = $username RETURN user, roles, home, suspended',
      { username },
    );
    const existingUser = users.records[0];
    const roles = await system.run('SHOW ROLES YIELD role, immutable WHERE role = $role RETURN role, immutable', { role });
    const existingRole = roles.records[0];
    if (existingRole?.get('immutable')) throw new Error('Expected role name is occupied by an immutable role; provisioning stopped');
    const rolePrivileges = existingRole
      ? await system.run('SHOW ROLE $role PRIVILEGES AS COMMANDS', { role })
      : null;
    const existingCommands = rolePrivileges?.records.map((record) => String(record.get('command'))) ?? [];
    if (existingCommands.some((command) => !expectedPrivileges.includes(command))) {
      console.error(JSON.stringify({ unexpectedPrivileges: existingCommands.filter((command) => !expectedPrivileges.includes(command)) }));
      throw new Error('Existing test role has unexpected privileges; no changes made');
    }

    if (existingUser) {
      const assigned = [...existingUser.get('roles')].sort();
      if (existingUser.get('home') !== 'isn-test' || existingUser.get('suspended') ||
          JSON.stringify(assigned) !== JSON.stringify(['PUBLIC', role])) {
        throw new Error('Existing test user has unexpected home, status, or role assignments; no changes made');
      }
      const secretFile = await readFile(credentialsPath, 'utf8').catch(() => '');
      const password = secretFile.match(/^NEO4J_TEST_PASSWORD=(.*)$/m)?.[1];
      if (!password) throw new Error('Test user exists but its local credential is unavailable; refusing password rotation');
      const check = neo4j.driver(uri, neo4j.auth.basic(username, password));
      try {
        await check.verifyConnectivity();
        const session = check.session({ database: 'isn-test' });
        try {
          const identity = await session.run('CALL db.info() YIELD name RETURN name');
          if (identity.records[0]?.get('name') !== 'isn-test') throw new Error('Test user target identity mismatch');
        } finally { await session.close(); }
        const devSession = check.session({ database: 'isn-dev' });
        try {
          await devSession.run('CALL db.ping()');
          throw new Error('Test account unexpectedly accessed isn-dev');
        } catch (error) {
          if (error.message === 'Test account unexpectedly accessed isn-dev' ||
              !String(error?.code ?? '').startsWith('Neo.ClientError.Security.')) throw error;
        } finally { await devSession.close(); }
      } finally { await check.close(); }
    } else {
      let existingCredentials = '';
      try { existingCredentials = await readFile(credentialsPath, 'utf8'); } catch {}
      if (existingCredentials) throw new Error('Credential file exists while test user is absent; inspect local state before provisioning');
      const password = randomBytes(36).toString('base64url');
      await writeFile(credentialsPath,
        `NODE_ENV=test\nNEO4J_URI=${uri}\nNEO4J_DATABASE=isn-test\nNEO4J_TEST_USERNAME=${username}\nNEO4J_TEST_PASSWORD=${password}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await chmod(credentialsPath, 0o600).catch(() => undefined);
      generatedFile = true;
      if (!existingRole) await system.run('CREATE ROLE isn_test_runner_role');
      await system.run(
        'CREATE USER $username SET PASSWORD $password CHANGE NOT REQUIRED SET HOME DATABASE $home',
        { username, password, home: 'isn-test' },
      );
      userCreated = true;
      await system.run('GRANT ROLE isn_test_runner_role TO USER isn_test_runner');
    }

    const testDatabase = driver.session({ database: 'isn-test' });
    try {
      for (const label of schemaLabels) {
        await testDatabase.run('CALL db.createLabel($name)', { name: label });
      }
      for (const relationshipType of schemaRelationshipTypes) {
        await testDatabase.run('CALL db.createRelationshipType($name)', { name: relationshipType });
      }
      for (const propertyName of schemaPropertyNames) {
        await testDatabase.run('CALL db.createProperty($name)', { name: propertyName });
      }
    } finally {
      await testDatabase.close();
    }

    for (const command of expectedPrivileges) {
      if (!existingCommands.includes(command)) await system.run(command);
    }

    const finalUser = await system.run(
      'SHOW USERS YIELD user, roles, home, suspended WHERE user = $username RETURN user, roles, home, suspended',
      { username },
    );
    const finalRoles = await system.run('SHOW ROLE $role PRIVILEGES AS COMMANDS', { role });
    const commands = finalRoles.records.map((record) => String(record.get('command')));
    const roleAssignment = finalUser.records[0];
    const assigned = roleAssignment ? [...roleAssignment.get('roles')].sort() : [];
    if (roleAssignment?.get('home') !== 'isn-test' ||
        JSON.stringify(assigned) !== JSON.stringify(['PUBLIC', role]) ||
        JSON.stringify([...commands].sort()) !== JSON.stringify([...expectedPrivileges].sort())) {
      console.error(JSON.stringify({
        homeDatabaseMatches: roleAssignment?.get('home') === 'isn-test',
        assignedRolesMatch: JSON.stringify(assigned) === JSON.stringify(['PUBLIC', role]),
        missingPrivileges: expectedPrivileges.filter((command) => !commands.includes(command)),
        unexpectedPrivileges: commands.filter((command) => !expectedPrivileges.includes(command)),
      }));
      throw new Error('Provisioned user or effective role grants did not match the approved least-privilege set');
    }
  } finally {
    await system.close();
  }

  const credentials = await readFile(credentialsPath, 'utf8');
  const password = credentials.match(/^NEO4J_TEST_PASSWORD=(.*)$/m)?.[1];
  if (!password) throw new Error('Local test password is missing after provisioning');
  const testDriver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    await testDriver.verifyConnectivity();
    const testSession = testDriver.session({ database: 'isn-test' });
    try {
      const identity = await testSession.run('CALL db.info() YIELD name RETURN name');
      if (identity.records[0]?.get('name') !== 'isn-test') throw new Error('Test database identity verification failed');
    } finally { await testSession.close(); }
    const devSession = testDriver.session({ database: 'isn-dev' });
    try {
      await devSession.run('CALL db.ping()');
      throw new Error('Test account unexpectedly accessed isn-dev');
    } catch (error) {
      if (error.message === 'Test account unexpectedly accessed isn-dev' || !String(error.code ?? '').startsWith('Neo.ClientError.Security.')) throw error;
    } finally { await devSession.close(); }
  } finally {
    await testDriver.close();
  }
  const verifyDatabase = driver.session({ database: 'isn-test' });
  try {
    const identity = await verifyDatabase.run('CALL db.info() YIELD name, id RETURN name, id');
    if (identity.records[0]?.get('name') !== 'isn-test' || typeof identity.records[0]?.get('id') !== 'string') {
      throw new Error('Test database identity changed during provisioning');
    }
    const after = await readDataCounts(verifyDatabase);
    if (JSON.stringify(after) !== JSON.stringify(databaseBaseline)) {
      throw new Error('Application graph counts changed during schema-token/grant provisioning');
    }
  } finally {
    await verifyDatabase.close();
  }
  console.log(JSON.stringify({ provisioned: true, username, role, homeDatabase: 'isn-test', devAccess: 'denied', schemaVersion, activeTransactionGate: 'clear', applicationDataPreserved: true, credentialsStoredLocally: true }));
} catch (error) {
  if (generatedFile && !userCreated) {
    await import('node:fs/promises').then(({ unlink }) => unlink(credentialsPath).catch(() => undefined));
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await driver.close();
}

async function assertMigrationCatalog(session, version) {
  const constraints = await session.run(
    'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
  );
  const requiredConstraints = [
    ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchema', ['key']],
    ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchemaMigration', ['version']],
    ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['id']],
    ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['email']],
    ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['id']],
    ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['jti']],
    ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthActivityEvent', ['eventId']],
    ...(version >= 4 ? [
      ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['pairKey']],
      ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['requestId']],
      ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
      ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
    ] : []),
    ...(version >= 5 ? [
      ['isn_post_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'Post', ['id']],
    ] : []),
  ];
  if (constraints.records.length !== requiredConstraints.length) {
    throw new Error('Constraint catalog does not match the verified migration version; provisioning stopped');
  }
  for (const [name, type, entityType, label, properties] of requiredConstraints) {
    if (!constraints.records.some((record) => record.get('name') === name && record.get('type') === type &&
        record.get('entityType') === entityType && JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
        JSON.stringify(record.get('properties')) === JSON.stringify(properties))) {
      throw new Error(`Required constraint ${name} is absent or drifted; provisioning stopped`);
    }
  }

  const indexes = await session.run(
    'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
  );
  const expectedIndexes = [
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
    ...(version >= 4 ? [
      ['isn_friendship_pair_key', 'RANGE', 'NODE', 'FriendshipPair', ['pairKey']],
      ['isn_friendship_request_id', 'RANGE', 'NODE', 'FriendshipPair', ['requestId']],
      ['isn_friendship_id', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
      ['isn_friendship_edge_pair_key', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
      ['isn_friendship_requests_sent', 'RANGE', 'NODE', 'FriendshipPair', ['senderId', 'requestStatus', 'requestId']],
      ['isn_friendship_requests_received', 'RANGE', 'NODE', 'FriendshipPair', ['recipientId', 'requestStatus', 'requestId']],
    ] : []),
    ...(version >= 5 ? [
      ['isn_post_id', 'RANGE', 'NODE', 'Post', ['id']],
      ['isn_post_author_chronology', 'RANGE', 'NODE', 'Post', ['authorId', 'createdAt', 'id']],
    ] : []),
  ];
  const applicationIndexes = indexes.records.filter((record) => record.get('type') !== 'LOOKUP');
  if (applicationIndexes.length !== expectedIndexes.length) {
    throw new Error('Index catalog does not match the verified migration version; provisioning stopped');
  }
  for (const [name, type, entityType, label, properties] of expectedIndexes) {
    if (!applicationIndexes.some((record) => record.get('name') === name && record.get('type') === type &&
        record.get('entityType') === entityType && JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
        JSON.stringify(record.get('properties')) === JSON.stringify(properties) && record.get('state') === 'ONLINE')) {
      throw new Error(`Required index ${name} is absent, offline, or drifted; provisioning stopped`);
    }
  }
}

async function assertNoFriendshipSchemaObjects(session) {
  const constraints = await session.run('SHOW CONSTRAINTS YIELD labelsOrTypes RETURN labelsOrTypes');
  const indexes = await session.run('SHOW INDEXES YIELD labelsOrTypes RETURN labelsOrTypes');
  const records = [...constraints.records, ...indexes.records];
  if (records.some((record) => Array.isArray(record.get('labelsOrTypes')) &&
      record.get('labelsOrTypes').some((value) => value === 'FriendshipPair' || value === 'FRIEND_WITH'))) {
    throw new Error('Unexpected Friendship schema objects exist before V4; provisioning stopped without writes');
  }
}

async function assertNoPostSchemaObjects(session) {
  const constraints = await session.run('SHOW CONSTRAINTS YIELD labelsOrTypes RETURN labelsOrTypes');
  const indexes = await session.run('SHOW INDEXES YIELD labelsOrTypes RETURN labelsOrTypes');
  const records = [...constraints.records, ...indexes.records];
  if (records.some((record) => Array.isArray(record.get('labelsOrTypes')) &&
      record.get('labelsOrTypes').some((value) => value === 'Post' || value === 'AUTHORED'))) {
    throw new Error('Unexpected Posts schema objects exist before V5; provisioning stopped without writes');
  }
}

async function readDataCounts(session) {
  const result = await session.run(
    `CALL { MATCH (user:User) RETURN count(user) AS users }
     CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
     CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
      CALL { MATCH (pair:FriendshipPair) RETURN count(pair) AS pairs }
      CALL { MATCH ()-[friendship:FRIEND_WITH]-() RETURN count(friendship) AS edges }
      CALL { MATCH (post:Post) RETURN count(post) AS posts }
      CALL { MATCH ()-[authored:AUTHORED]->() RETURN count(authored) AS authored }
      RETURN users, sessions, events, pairs, edges, posts, authored`,
  );
  const record = result.records[0];
  if (!record) throw new Error('Could not capture the application data baseline');
  return Object.fromEntries(['users', 'sessions', 'events', 'pairs', 'edges', 'posts', 'authored']
    .map((key) => [key, toNumber(record.get(key))]));
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
