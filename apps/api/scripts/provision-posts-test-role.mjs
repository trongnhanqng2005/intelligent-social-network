import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import friendshipSupport from '../../../tests/fixtures/friendships/acceptance-support.cjs';
import { capturePostsDataFingerprint, splitApprovedPostPrivileges } from '../../../tests/fixtures/posts/acceptance-support.mjs';
import { assertPostsProvisioningTarget, assertPostsWorktreeRoot } from './posts-operation-safety.mjs';

const root = resolve('.');
const username = 'isn_test_runner';
const roleName = 'isn_test_runner_role';
const baselinePath = resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json');
let stage = 'invocation';
let adminDriver;
let testDriver;

try {
  assertPostsProvisioningTarget();
  assertPostsWorktreeRoot(
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(),
    root,
  );
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'feature/posts-feed');
  execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });
  await assertLocalConfigurations();
  const approved = await readPrivilegeManifest();
  const { existing, posts } = splitApprovedPostPrivileges(approved);
  assert.equal(posts.length, 14, 'The approved Post/AUTHORED privilege delta changed.');

  adminDriver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
  );
  testDriver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  stage = 'read-only-preflight';
  const testSession = testDriver.session({ database: 'isn-test' });
  const adminData = adminDriver.session({ database: 'isn-test' });
  const system = adminDriver.session({ database: 'system' });
  const deniedDev = testDriver.session({ database: 'isn-dev' });
  let baseline;
  try {
    await Promise.all([adminDriver.verifyConnectivity(), testDriver.verifyConnectivity()]);
    const identity = await testSession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const testUser = await testSession.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(testUser.records[0]?.get('username'), username);
    assert.deepEqual([...testUser.records[0]?.get('roles')].sort(), ['PUBLIC', roleName]);
    await assert.rejects(deniedDev.run('CALL db.ping()'), (error) =>
      /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    const history = await testSession.run(
      `MATCH (migration:ISNSchemaMigration)
       RETURN migration.version AS version,migration.name AS name,migration.checksum AS checksum,
              migration.status AS status,migration.appliedAt IS NOT NULL AS applied,
              migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
    );
    assert.deepEqual(history.records.map((record) => [
      asNumber(record.get('version')), record.get('name'), record.get('checksum'), record.get('status'),
      record.get('applied'), record.get('verified'),
    ]), [
      [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2', 'VERIFIED', true, true],
      [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de', 'VERIFIED', true, true],
      [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee', 'VERIFIED', true, true],
      [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2', 'VERIFIED', true, true],
    ]);
    const marker = await testSession.run("MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version");
    assert.equal(asNumber(marker.records[0]?.get('version')), 4);
    const v5History = await testSession.run('MATCH (migration:ISNSchemaMigration {version:5}) RETURN count(migration) AS count');
    assert.equal(asNumber(v5History.records[0]?.get('count')), 0);
    await assertNoPostSchemaObjects(adminData);
    const currentBaseline = await capturePostsDataFingerprint(adminData);
    const recordedBaseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.equal(recordedBaseline.database, 'isn-test');
    assert.equal(recordedBaseline.databaseId, friendshipSupport.DATABASE_ID);
    baseline = { dataFingerprint: currentBaseline.dataFingerprint, counts: currentBaseline.counts };
    assert.deepEqual(baseline, {
      dataFingerprint: recordedBaseline.dataFingerprint,
      counts: recordedBaseline.counts,
    }, 'Preservation fingerprint changed after the approved read-only V4 preflight.');

    const currentUser = await system.run(
      'SHOW USERS YIELD user,roles,home,suspended WHERE user=$username RETURN user,roles,home,suspended',
      { username },
    );
    assert.equal(currentUser.records.length, 1);
    assert.equal(currentUser.records[0]?.get('home'), 'isn-test');
    assert.equal(currentUser.records[0]?.get('suspended'), false);
    assert.deepEqual([...currentUser.records[0]?.get('roles')].sort(), ['PUBLIC', roleName]);
    const active = await system.run(
      `SHOW TRANSACTIONS YIELD database,transactionId
       WHERE database='isn-test' RETURN transactionId`,
    );
    assert.equal(active.records.length, 0, 'An active isn-test transaction blocks the privilege write.');
    await assertAdminIdentityAndServer(system);
    await assertRolePrivileges(system, existing, existing);
  } finally {
    await Promise.all([testSession.close(), adminData.close(), system.close(), deniedDev.close()]);
  }

  stage = 'post-privilege-grants';
  const grantSession = adminDriver.session({ database: 'system' });
  try {
    for (const command of posts) await grantSession.run(command);
    await assertRolePrivileges(grantSession, approved, approved);
  } finally {
    await grantSession.close();
  }

  stage = 'post-grant-verification';
  const verifySession = testDriver.session({ database: 'isn-test' });
  const verifyDev = testDriver.session({ database: 'isn-dev' });
  const verifyAdminData = adminDriver.session({ database: 'isn-test' });
  try {
    const identity = await verifySession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    await assert.rejects(verifyDev.run('CALL db.ping()'), (error) =>
      /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    assert.deepEqual(await capturePostsDataFingerprint(verifyAdminData), baseline,
      'The additive Post privilege grants changed application data.');
  } finally {
    await Promise.all([verifySession.close(), verifyDev.close(), verifyAdminData.close()]);
  }
  console.log(JSON.stringify({
    scenario: 'ISN-C-POSTS-RESTRICTED-ROLE',
    database: 'isn-test',
    databaseId: friendshipSupport.DATABASE_ID,
    principal: username,
    role: roleName,
    grantsAdded: posts.length,
    grantScope: 'Post nodes and AUTHORED relationships only',
    priorV4GrantsPreserved: true,
    isnDevDenied: true,
    applicationFingerprintPreserved: true,
  }));
} catch (error) {
  console.error(JSON.stringify({
    scenario: 'ISN-C-POSTS-RESTRICTED-ROLE',
    stage,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    partialGrantPossible: stage === 'post-privilege-grants',
  }));
  process.exitCode = 1;
} finally {
  await Promise.all([adminDriver?.close(), testDriver?.close()]);
}

async function assertLocalConfigurations() {
  const admin = parseConfig(await readFile(resolve(root, 'apps/api/.env'), 'utf8'));
  const test = parseConfig(await readFile(resolve(root, 'apps/api/.env.test.local'), 'utf8'));
  assert.equal(admin.NODE_ENV, 'development');
  assert.equal(admin.NEO4J_DATABASE, 'isn-dev');
  assert.equal(admin.NEO4J_URI, process.env.NEO4J_URI);
  assert.equal(admin.NEO4J_USERNAME, process.env.NEO4J_USERNAME);
  assert.equal(admin.NEO4J_PASSWORD, process.env.NEO4J_PASSWORD);
  assert.equal(test.NODE_ENV, 'test');
  assert.equal(test.NEO4J_DATABASE, 'isn-test');
  assert.equal(test.NEO4J_URI, process.env.NEO4J_URI);
  assert.equal(test.NEO4J_TEST_USERNAME, username);
  assert.equal(test.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_USERNAME);
  assert.equal(test.NEO4J_TEST_PASSWORD, process.env.NEO4J_TEST_PASSWORD);
  assert.equal(test.NEO4J_USERNAME ?? '', '');
  assert.equal(test.NEO4J_PASSWORD ?? '', '');
  const source = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
  assert.ok(source.includes("'feature/posts-feed'"));
}

async function readPrivilegeManifest() {
  const source = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
  const match = source.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
  assert.ok(match);
  const commands = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((item) => item[1]);
  assert.ok(commands.length >= 80);
  assert.equal(new Set(commands).size, commands.length);
  return commands;
}

async function assertNoPostSchemaObjects(session) {
  const constraints = await session.run('SHOW CONSTRAINTS YIELD labelsOrTypes RETURN labelsOrTypes');
  const indexes = await session.run('SHOW INDEXES YIELD labelsOrTypes RETURN labelsOrTypes');
  assert.equal([...constraints.records, ...indexes.records].some((record) =>
    Array.isArray(record.get('labelsOrTypes')) &&
    record.get('labelsOrTypes').some((label) => label === 'Post' || label === 'AUTHORED')),
  false, 'Unexpected Post schema objects exist before V5.');
}

async function assertAdminIdentityAndServer(system) {
  const identity = await system.run('CALL dbms.showCurrentUser() YIELD username RETURN username');
  assert.equal(identity.records[0]?.get('username'), process.env.NEO4J_USERNAME);
  const server = await system.run('CALL dbms.components() YIELD versions,edition RETURN versions[0] AS version,edition');
  assert.equal(server.records[0]?.get('version'), '2026.09.0');
  assert.equal(server.records[0]?.get('edition'), 'enterprise');
}

async function assertRolePrivileges(system, expectedRole, expectedEffective) {
  const role = await system.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
  const roleCommands = role.records.map((record) => String(record.get('command'))).sort();
  assert.deepEqual(roleCommands, [...expectedRole].sort());
  const inherited = await system.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS');
  const publicCommands = inherited.records.map((record) => String(record.get('command')));
  assert.equal(publicCommands.some((command) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(command)), false);
  const user = await system.run('SHOW USER isn_test_runner PRIVILEGES AS COMMANDS');
  const effective = user.records.map((record) => String(record.get('command'))).sort();
  const expectedCommands = [...expectedEffective, ...publicCommands]
    .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'))
    .sort();
  assert.deepEqual(effective, expectedCommands);
}

function parseConfig(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  return values;
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
