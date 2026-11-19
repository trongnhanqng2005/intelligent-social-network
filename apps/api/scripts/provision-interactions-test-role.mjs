import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import { execFileSync } from 'node:child_process';
import friendshipSupport from '../../../tests/fixtures/friendships/acceptance-support.cjs';
import { capturePostsDataFingerprint } from '../../../tests/fixtures/posts/acceptance-support.mjs';
import { assertPostsProvisioningTarget, assertPostsTestTarget, assertPostsWorktreeRoot } from './posts-operation-safety.mjs';

const root = resolve('.');
const username = 'isn_test_runner';
const roleName = 'isn_test_runner_role';
const apply = process.argv.includes('--apply');
const approved = process.env.ISN_TEST_WRITE_WINDOW === 'owner-approved';
const v6 = [
  ...['retryKey', 'id', 'clientId', 'postId', 'content', 'originalContentHash', 'createdAt', 'updatedAt', 'version', 'deleted']
    .map((property) => `GRANT MATCH {${property}} ON GRAPH ` + '`isn-test`' + ` NODE Comment TO ` + '`isn_test_runner_role`'),
  'GRANT CREATE ON GRAPH `isn-test` NODE Comment TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` NODE Comment TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP ON_POST TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP ON_POST TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP ON_POST TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP WROTE_COMMENT TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP WROTE_COMMENT TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP WROTE_COMMENT TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` RELATIONSHIP LIKED TO `isn_test_runner_role`',
  'GRANT CREATE ON GRAPH `isn-test` RELATIONSHIP LIKED TO `isn_test_runner_role`',
  'GRANT DELETE ON GRAPH `isn-test` RELATIONSHIP LIKED TO `isn_test_runner_role`',
  ...['retryKey', 'id', 'clientId', 'postId', 'content', 'originalContentHash', 'createdAt', 'updatedAt', 'version', 'deleted']
    .map((property) => `GRANT SET PROPERTY {${property}} ON GRAPH ` + '`isn-test`' + ` NODE Comment TO ` + '`isn_test_runner_role`'),
  'GRANT MERGE {retryKey} ON GRAPH `isn-test` NODE Comment TO `isn_test_runner_role`',
];
const expectedV6 = 10 + 2 + ['ON_POST', 'WROTE_COMMENT', 'LIKED'].length * 3 + 10 + 1;
const v6RelationshipTypes = ['LIKED', 'WROTE_COMMENT', 'ON_POST'];
const v6PropertyNames = ['clientId', 'originalContentHash', 'content', 'updatedAt', 'version', 'deleted'];
assert.equal(v6.length, expectedV6);
if (process.argv.some((argument) => argument !== '--apply' && argument !== process.argv[0] && argument !== process.argv[1])) {
  throw new Error('Only the optional --apply argument is supported');
}
if (apply && !approved) throw new Error('Applying V6 grants requires invocation-only ISN_TEST_WRITE_WINDOW=owner-approved');

let adminDriver;
let testDriver;
let stage = 'configuration';
try {
  if (apply) assertPostsProvisioningTarget();
  assertPostsWorktreeRoot(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(), root);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/likes-comments');
  execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], { cwd: root, stdio: 'ignore' });
  const admin = parseConfig(await readFile(resolve(root, 'apps/api/.env'), 'utf8'));
  const test = parseConfig(await readFile(resolve(root, 'apps/api/.env.test.local'), 'utf8'));
  assert.equal(admin.NODE_ENV, 'development');
  assert.equal(admin.NEO4J_DATABASE, 'isn-dev');
  assertPostsTestTarget(test);
  assert.equal(test.NEO4J_DATABASE, 'isn-test');
  assert.equal(test.NEO4J_TEST_USERNAME, username);
  assert.equal(test.NEO4J_USERNAME ?? '', '');
  assert.equal(test.NEO4J_PASSWORD ?? '', '');
  const uri = process.env.NEO4J_URI;
  assert.ok(uri);
  assert.equal(admin.NEO4J_URI, uri);
  assert.equal(admin.NEO4J_USERNAME, process.env.NEO4J_USERNAME);
  assert.equal(admin.NEO4J_PASSWORD, process.env.NEO4J_PASSWORD);
  assert.equal(test.NEO4J_URI, uri);
  assert.equal(test.NEO4J_TEST_PASSWORD, process.env.NEO4J_TEST_PASSWORD);
  const baseline = await readFile(resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json'), 'utf8');
  const recordedBaseline = JSON.parse(baseline);
  assert.equal(recordedBaseline.version, 1);
  assert.equal(recordedBaseline.database, 'isn-test');
  assert.equal(recordedBaseline.databaseId, friendshipSupport.DATABASE_ID);
  assert.equal(recordedBaseline.v4PreservationFingerprint, 'd5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437');

  adminDriver = neo4j.driver(uri, neo4j.auth.basic(admin.NEO4J_USERNAME, admin.NEO4J_PASSWORD));
  testDriver = neo4j.driver(uri, neo4j.auth.basic(username, test.NEO4J_TEST_PASSWORD));
  stage = 'connection-and-target-assertions';
  const testSession = testDriver.session({ database: 'isn-test' });
  const adminData = adminDriver.session({ database: 'isn-test' });
  const system = adminDriver.session({ database: 'system' });
  const deniedDev = testDriver.session({ database: 'isn-dev' });
  let v5;
  let fingerprint;
  let roleWasComplete = false;
  try {
    await Promise.all([adminDriver.verifyConnectivity(), testDriver.verifyConnectivity()]);
    const identity = await testSession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const user = await testSession.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(user.records[0]?.get('username'), username);
    assert.deepEqual([...user.records[0]?.get('roles')].sort(), ['PUBLIC', roleName]);
    await assert.rejects(deniedDev.run('CALL db.ping()'), (error) => /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    stage = 'v5-role-manifest';
    const manifestSource = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
    const match = manifestSource.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
    assert.ok(match, 'Committed V5 privilege manifest is unavailable');
    v5 = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((item) => item[1]);
    assert.ok(v5.length >= 90);
    assert.equal(new Set(v5).size, v5.length);
    stage = 'v5-migration-history';
    const actualHistory = await testSession.run(`MATCH (m:ISNSchemaMigration)
      RETURN m.version AS version,m.name AS name,m.checksum AS checksum,m.status AS status,
      m.appliedAt IS NOT NULL AS applied,m.verifiedAt IS NOT NULL AS verified ORDER BY version`);
    const expectedHistory = [
      [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2'],
      [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de'],
      [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee'],
      [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2'],
      [5, 'posts-feed', '48613d31278476128f0d904ad40c76c21c68d61d20b2b3fa526f423de63be523'],
    ].map(([version, name, checksum]) => [version, name, checksum, 'VERIFIED', true, true]);
    assert.deepEqual(actualHistory.records.map((record) => [numberValue(record.get('version')), record.get('name'), record.get('checksum'), record.get('status'), record.get('applied'), record.get('verified')]), expectedHistory);
    stage = 'v5-schema-marker';
    const marker = await testSession.run("MATCH (s:ISNSchema {key:'application'}) RETURN s.version AS version");
    assert.equal(numberValue(marker.records[0]?.get('version')), 5);
    stage = 'reserved-v6-schema';
    const constraints = await testSession.run('SHOW CONSTRAINTS YIELD name,labelsOrTypes RETURN name,labelsOrTypes');
    const indexes = await testSession.run('SHOW INDEXES YIELD name,labelsOrTypes RETURN name,labelsOrTypes');
    for (const record of [...constraints.records, ...indexes.records]) {
      const names = record.get('labelsOrTypes');
      assert.equal(record.get('name') === 'isn_comment_retry_key' || record.get('name') === 'isn_comment_id' ||
        record.get('name') === 'isn_comment_post_chronology' || (Array.isArray(names) &&
          names.some((name) => ['Comment', 'ON_POST', 'WROTE_COMMENT'].includes(name))),
      false, 'Reserved V6 schema objects already exist; inspect manually');
    }
    stage = 'interaction-data-absence';
    const comments = await adminData.run(`CALL { MATCH (c:Comment) RETURN count(c) AS comments }
      CALL { MATCH (:Comment)-[r:ON_POST]->(:Post) RETURN count(r) AS onPost }
      CALL { MATCH (:User)-[r:WROTE_COMMENT]->(:Comment) RETURN count(r) AS wroteComment }
      CALL { MATCH (:User)-[r:LIKED]->(:Post) RETURN count(r) AS liked }
      RETURN comments,onPost,wroteComment,liked`);
    for (const key of ['comments', 'onPost', 'wroteComment', 'liked']) assert.equal(numberValue(comments.records[0]?.get(key)), 0);
    stage = 'v5-preservation-fingerprint';
    fingerprint = await capturePostsDataFingerprint(adminData);
    assert.deepEqual(fingerprint, { dataFingerprint: recordedBaseline.dataFingerprint, counts: recordedBaseline.counts });
    stage = 'exact-role-and-effective-privileges';
    const roleResult = await system.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
    const roleCommands = normalizeCommands(roleResult.records);
    const baselineRole = JSON.stringify(roleCommands) === JSON.stringify([...v5].sort());
    roleWasComplete = JSON.stringify(roleCommands) === JSON.stringify([...v5, ...v6].sort());
    assert.ok(baselineRole || roleWasComplete, 'Existing role is neither the exact V5 baseline nor the complete exact V6 role');
    const publicResult = await system.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS');
    const publicCommands = normalizeCommands(publicResult.records);
    assert.equal(publicCommands.some((command) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(command)), false);
    const effectiveResult = await system.run('SHOW USER isn_test_runner PRIVILEGES AS COMMANDS');
    const effective = normalizeCommands(effectiveResult.records);
    const expectedEffective = [...(roleWasComplete ? [...v5, ...v6] : v5), ...publicCommands]
      .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role')).sort();
    assert.deepEqual(effective, expectedEffective);
    const active = await system.run("SHOW TRANSACTIONS YIELD database,transactionId WHERE database='isn-test' RETURN transactionId");
    assert.equal(active.records.length, 0, 'An active isn-test transaction blocks privilege changes');
    const liveUser = await system.run('SHOW USERS YIELD user,roles,home,suspended WHERE user=$username RETURN roles,home,suspended', { username });
    assert.equal(liveUser.records.length, 1);
    assert.equal(liveUser.records[0]?.get('home'), 'isn-test');
    assert.equal(liveUser.records[0]?.get('suspended'), false);
    assert.deepEqual([...liveUser.records[0]?.get('roles')].sort(), ['PUBLIC', roleName]);
    const adminIdentity = await system.run('CALL dbms.showCurrentUser() YIELD username RETURN username');
    assert.equal(adminIdentity.records[0]?.get('username'), admin.NEO4J_USERNAME);
    stage = 'privilege-command-plans';
    for (const command of v6) await system.run('EXPLAIN ' + command);
    if (apply) {
      stage = 'privilege-application';
      for (const relationshipType of v6RelationshipTypes) {
        await adminData.run('CALL db.createRelationshipType($name)', { name: relationshipType });
      }
      for (const propertyName of v6PropertyNames) {
        await adminData.run('CALL db.createProperty($name)', { name: propertyName });
      }
      if (!roleWasComplete) for (const command of v6) await system.run(command);
    }
    const after = await system.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
    assert.deepEqual(normalizeCommands(after.records),
      apply ? [...v5, ...v6].sort() : roleWasComplete ? [...v5, ...v6].sort() : [...v5].sort());
  } finally {
    await Promise.all([testSession.close(), adminData.close(), system.close(), deniedDev.close()]);
  }
  if (apply) {
    stage = 'post-application-preservation-fingerprint';
    const verifyPreservation = adminDriver.session({ database: 'isn-test' });
    try {
      const afterFingerprint = await capturePostsDataFingerprint(verifyPreservation);
      assert.deepEqual(afterFingerprint, { dataFingerprint: recordedBaseline.dataFingerprint, counts: recordedBaseline.counts });
    } finally { await verifyPreservation.close(); }
  }
  const verifyDev = testDriver.session({ database: 'isn-dev' });
  const verifyTest = testDriver.session({ database: 'isn-test' });
  try {
    await assert.rejects(verifyDev.run('CALL db.ping()'), (error) => /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    const identity = await verifyTest.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
  } finally { await Promise.all([verifyDev.close(), verifyTest.close()]); }
  console.log(JSON.stringify({ scenario: 'ISN-V6-INTERACTIONS-RESTRICTED-ROLE', mode: apply ? 'apply' : 'dry-run', principal: username, database: 'isn-test', grants: v6.length, v5Preserved: true, isnDevDenied: true }));
} catch (error) {
  console.error(JSON.stringify({ scenario: 'ISN-V6-INTERACTIONS-RESTRICTED-ROLE', stage, errorName: error instanceof Error ? error.name : 'UnknownError', partialGrantPossible: stage === 'privilege-application' }));
  process.exitCode = 1;
} finally { await Promise.all([adminDriver?.close(), testDriver?.close()]); }

function parseConfig(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  return values;
}

function numberValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}

function normalizeCommands(records) {
  return records.map((record) => String(record.get('command'))).sort();
}
