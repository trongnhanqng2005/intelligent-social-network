import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import neo4j from 'neo4j-driver';
import { Neo4jMigrationService } from '../dist/neo4j/neo4j-migrations.js';
import friendshipSupport from '../../../tests/fixtures/friendships/acceptance-support.cjs';
import { capturePostsDataFingerprint } from '../../../tests/fixtures/posts/acceptance-support.mjs';
import { assertPostsProvisioningTarget, assertPostsTestTarget, assertPostsWorktreeRoot } from './posts-operation-safety.mjs';

const root = resolve('.');
const username = 'isn_test_runner';
const role = 'isn_test_runner_role';
const apply = process.argv.includes('--apply');
const approved = process.env.ISN_TEST_WRITE_WINDOW === 'owner-approved';
const eventProperties = ['eventId', 'schemaVersion', 'eventType', 'occurredAt', 'source', 'actorId', 'targetUserId', 'objectType', 'objectId'];
const v6Checksum = '3e8e51157695d25e64ba23196cd93d03d7be36913afb0fcf40ce372116cba6b3';
const reservedActivitySchemaNames = ['isn_activity_event_id', 'isn_activity_event_occurred_at'];
const v7 = [
  ...eventProperties.map((property) => `GRANT MATCH {${property}} ON GRAPH \`isn-test\` NODE ActivityEvent TO \`${role}\``),
  `GRANT CREATE ON GRAPH \`isn-test\` NODE ActivityEvent TO \`${role}\``,
  ...eventProperties.map((property) => `GRANT SET PROPERTY {${property}} ON GRAPH \`isn-test\` NODE ActivityEvent TO \`${role}\``),
  `GRANT DELETE ON GRAPH \`isn-test\` NODE ActivityEvent TO \`${role}\``,
];
if (process.argv.some((arg) => !['--apply', process.argv[0], process.argv[1]].includes(arg))) throw new Error('Only optional --apply is supported');
if (apply && !approved) throw new Error('--apply requires invocation-only ISN_TEST_WRITE_WINDOW=owner-approved');

let adminDriver; let testDriver; let stage = 'configuration';
try {
  assertPostsWorktreeRoot(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(), root);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'codex/activity-logging', 'All modes require the owner-approved branch');
  if (apply) assertPostsProvisioningTarget();
  const envFile = process.env.ISN_ACTIVITY_ENV_FILE || 'apps/api/.env';
  const testFile = process.env.ISN_ACTIVITY_TEST_ENV_FILE || 'apps/api/.env.test.local';
  const admin = parseConfig(await readFile(resolve(root, envFile), 'utf8'));
  const test = parseConfig(await readFile(resolve(root, testFile), 'utf8'));
  assert.equal(admin.NODE_ENV, 'development'); assert.equal(admin.NEO4J_DATABASE, 'isn-dev');
  assertPostsTestTarget(test);
  assert.equal(test.NEO4J_DATABASE, 'isn-test'); assert.equal(test.NEO4J_TEST_USERNAME, username);
  assert.equal(test.NEO4J_USERNAME || '', ''); assert.equal(test.NEO4J_PASSWORD || '', '');
  const uri = process.env.NEO4J_URI;
  assert.ok(uri); assert.equal(admin.NEO4J_URI, uri); assert.equal(test.NEO4J_URI, uri);
  assert.equal(admin.NEO4J_USERNAME, process.env.NEO4J_USERNAME); assert.equal(admin.NEO4J_PASSWORD, process.env.NEO4J_PASSWORD);
  assert.equal(test.NEO4J_TEST_PASSWORD, process.env.NEO4J_TEST_PASSWORD);
  const baseline = JSON.parse(await readFile(resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json'), 'utf8'));
  assert.equal(baseline.databaseId, friendshipSupport.DATABASE_ID);
  adminDriver = neo4j.driver(uri, neo4j.auth.basic(admin.NEO4J_USERNAME, admin.NEO4J_PASSWORD));
  testDriver = neo4j.driver(uri, neo4j.auth.basic(username, test.NEO4J_TEST_PASSWORD));
  const testSession = testDriver.session({ database: 'isn-test' }); const adminData = adminDriver.session({ database: 'isn-test' });
  const system = adminDriver.session({ database: 'system' }); const deniedDev = testDriver.session({ database: 'isn-dev' });
  try {
    stage = 'target-identity';
    await Promise.all([adminDriver.verifyConnectivity(), testDriver.verifyConnectivity()]);
    const identity = await testSession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test'); assert.equal(identity.records[0]?.get('id'), friendshipSupport.DATABASE_ID);
    const user = await testSession.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(user.records[0]?.get('username'), username); assert.deepEqual([...user.records[0]?.get('roles')].sort(), ['PUBLIC', role]);
    await assert.rejects(deniedDev.run('CALL db.ping()'), securityError);
    stage = 'v6-history-and-preservation';
    const migrationService = new Neo4jMigrationService({ database: 'isn-test', executeRead: (work) => testSession.executeRead(work) });
    const migrationStatus = await migrationService.getStatus();
    assert.equal(migrationStatus.status, 'incomplete', 'Only a coherent V6 baseline may proceed to V7');
    assert.equal(migrationStatus.version, 6);
    assert.equal(migrationStatus.migrations.length, 6, 'V6 migration history must be complete');
    assert.equal(migrationStatus.migrations[5]?.checksum, v6Checksum, 'V6 checksum must match the immutable verified definition');
    assert.ok(migrationStatus.migrations.every((migration, index) => migration.version === index + 1 && migration.status === 'VERIFIED' && migration.appliedAt && migration.verifiedAt));
    const fingerprint = await capturePostsDataFingerprint(adminData); assert.deepEqual(fingerprint, { dataFingerprint: baseline.dataFingerprint, counts: baseline.counts });
    const events = await adminData.run('MATCH (e:ActivityEvent) RETURN count(e) AS count'); assert.equal(numberValue(events.records[0]?.get('count')), 0);
    stage = 'reserved-indexes';
    const constraints = await testSession.run('SHOW CONSTRAINTS YIELD name,labelsOrTypes RETURN name,labelsOrTypes');
    const indexes = await testSession.run('SHOW INDEXES YIELD name,labelsOrTypes RETURN name,labelsOrTypes');
    for (const schema of [constraints, indexes]) {
      assert.equal(schema.records.some((r) => reservedActivitySchemaNames.includes(r.get('name')) || (Array.isArray(r.get('labelsOrTypes')) && r.get('labelsOrTypes').includes('ActivityEvent'))), false, 'V7-reserved names and ActivityEvent schema must not pre-exist');
    }
    stage = 'exact-role';
    const manifest = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
    const match = manifest.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u); assert.ok(match);
    const v5 = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((m) => m[1]);
    const roleResult = await system.run(`SHOW ROLE ${role} PRIVILEGES AS COMMANDS`); const actual = commands(roleResult.records);
    const v6 = expectedV6Grants();
    assert.deepEqual(actual, [...v5, ...v6].sort(), 'Existing role must be the exact V6 baseline; no partial or pre-existing V7 changes');
    const pub = commands((await system.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS')).records);
    assert.equal(pub.some((c) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(c)), false);
    const effective = commands((await system.run(`SHOW USER ${username} PRIVILEGES AS COMMANDS`)).records);
    assert.deepEqual(effective, [...actual, ...pub].map((c) => c.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role')).sort());
    const active = await system.run("SHOW TRANSACTIONS YIELD database,transactionId WHERE database='isn-test' RETURN transactionId"); assert.equal(active.records.length, 0);
    stage = 'plan-and-provision';
    for (const command of v7) await system.run(`EXPLAIN ${command}`);
    if (apply) {
      await adminData.run("CALL db.createLabel('ActivityEvent')");
      for (const name of eventProperties) await adminData.run('CALL db.createProperty($name)', { name });
      for (const command of v7) await system.run(command);
    }
    const expectedRole = apply ? [...actual, ...v7].sort() : actual;
    assert.deepEqual(commands((await system.run(`SHOW ROLE ${role} PRIVILEGES AS COMMANDS`)).records), expectedRole);
    assert.deepEqual(commands((await system.run(`SHOW USER ${username} PRIVILEGES AS COMMANDS`)).records),
      [...expectedRole, ...pub].map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role')).sort());
    assert.deepEqual(await capturePostsDataFingerprint(adminData), fingerprint);
  } finally { await Promise.all([testSession.close(), adminData.close(), system.close(), deniedDev.close()]); }
  const dev = testDriver.session({ database: 'isn-dev' }); try { await assert.rejects(dev.run('CALL db.ping()'), securityError); } finally { await dev.close(); }
  console.log(JSON.stringify({ scenario: 'ISN-V7-ACTIVITY-RESTRICTED-ROLE', mode: apply ? 'apply' : 'dry-run', grants: v7.length, database: 'isn-test', isnDevDenied: true }));
} catch (error) { console.error(JSON.stringify({ scenario: 'ISN-V7-ACTIVITY-RESTRICTED-ROLE', stage, errorName: error instanceof Error ? error.name : 'UnknownError', code: typeof error?.code === 'string' ? error.code : undefined, partialGrantPossible: stage === 'plan-and-provision' && apply })); process.exitCode = 1; }
finally { await Promise.all([adminDriver?.close(), testDriver?.close()]); }

function parseConfig(text) { const result = {}; for (const line of text.split(/\r?\n/u)) { const m = line.match(/^\s*([^#=]+)\s*=\s*(.*?)\s*$/u); if (m) result[m[1]] = m[2].replace(/^(['"])(.*)\1$/u, '$2'); } return result; }
function numberValue(value) { return typeof value === 'number' ? value : value?.toNumber?.() ?? Number.NaN; }
function commands(records) { return records.map((r) => String(r.get('command'))).sort(); }
function securityError(error) { return /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')); }
function expectedV6Grants() { const properties = ['retryKey', 'id', 'clientId', 'postId', 'content', 'originalContentHash', 'createdAt', 'updatedAt', 'version', 'deleted']; return [...properties.map((p) => `GRANT MATCH {${p}} ON GRAPH \`isn-test\` NODE Comment TO \`${role}\``), `GRANT CREATE ON GRAPH \`isn-test\` NODE Comment TO \`${role}\``, `GRANT DELETE ON GRAPH \`isn-test\` NODE Comment TO \`${role}\``, ...['ON_POST', 'WROTE_COMMENT', 'LIKED'].flatMap((t) => [`GRANT MATCH {*} ON GRAPH \`isn-test\` RELATIONSHIP ${t} TO \`${role}\``, `GRANT CREATE ON GRAPH \`isn-test\` RELATIONSHIP ${t} TO \`${role}\``, `GRANT DELETE ON GRAPH \`isn-test\` RELATIONSHIP ${t} TO \`${role}\``]), ...properties.map((p) => `GRANT SET PROPERTY {${p}} ON GRAPH \`isn-test\` NODE Comment TO \`${role}\``), `GRANT MERGE {retryKey} ON GRAPH \`isn-test\` NODE Comment TO \`${role}\``]; }
