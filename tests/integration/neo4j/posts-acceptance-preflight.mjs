import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import neo4j from 'neo4j-driver';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertPostsScenarioExecutionTarget,
  assertPostsScenarioPortsFree,
} from '../../fixtures/posts/scenario-runner.mjs';
import { capturePostsDataFingerprint } from '../../fixtures/posts/acceptance-support.mjs';
import {
  assertExactRestrictedPrivileges,
  assertV5Catalog,
  assertV5History,
  fingerprint,
  runPostsPreflightQueries,
} from '../../fixtures/posts/scenario-preflight.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const expectedDatabaseId = '336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786';
const baselinePath = resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json');

export async function runPostsAcceptancePreflight({ environment = process.env, requireFreePorts = true } = {}) {
  let stage = 'environment';
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  let baseline;
  let testDriver;
  let adminDriver;
  let testSession;
  let dataSession;
  let systemSession;

  try {
    assertPostsScenarioExecutionTarget({
      environment,
      cwd: process.cwd(),
      repositoryRoot: root,
      branch,
      baselineAncestor: hasApprovedBaselineAncestor(),
    });
    assert.equal(normalizePath(process.cwd()), normalizePath(root));
    assert.equal(environment.NEO4J_TEST_USERNAME, 'isn_test_runner');
    stage = 'resources-and-ports';
    if (requireFreePorts) await assertPostsScenarioPortsFree([3312, 5182]);
    stage = 'recovery-manifests';
    await assertNoUnresolvedManifests();

    stage = 'preserved-baseline';
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.equal(baseline.version, 1);
    assert.equal(baseline.database, 'isn-test');
    assert.equal(baseline.databaseId, expectedDatabaseId);
    assert.equal(baseline.v4PreservationFingerprint, 'd5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437');

    stage = 'read-only-connections';
    const admin = await readAdminSettings(environment.NEO4J_URI);
    assert.notEqual(admin.username, environment.NEO4J_TEST_USERNAME);
    assert.notEqual(admin.password, environment.NEO4J_TEST_PASSWORD);
    testDriver = neo4j.driver(environment.NEO4J_URI, neo4j.auth.basic(
      environment.NEO4J_TEST_USERNAME, environment.NEO4J_TEST_PASSWORD,
    ));
    adminDriver = neo4j.driver(admin.uri, neo4j.auth.basic(admin.username, admin.password));
    await Promise.all([testDriver.verifyConnectivity(), adminDriver.verifyConnectivity()]);
    testSession = testDriver.session({ database: 'isn-test' });
    dataSession = adminDriver.session({ database: 'isn-test' });
    systemSession = adminDriver.session({ database: 'system' });

    stage = 'database-identity-and-principal';
    const identity = await testSession.run('CALL db.info() YIELD name,id RETURN name,id');
    assert.equal(identity.records[0]?.get('name'), 'isn-test');
    assert.equal(identity.records[0]?.get('id'), expectedDatabaseId);
    const principal = await testSession.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles');
    assert.equal(principal.records[0]?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    const dev = testDriver.session({ database: 'isn-dev' });
    try {
      await assert.rejects(dev.run('CALL db.ping()'), (error) =>
        /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    } finally {
      await dev.close();
    }

    stage = 'current-v5-migration-history';
    const [{ Neo4jService }, { Neo4jMigrationService, migrationDefinitions, checksumMigration }] = await Promise.all([
      import('../../../apps/api/dist/neo4j/neo4j.service.js'),
      import('../../../apps/api/dist/neo4j/neo4j-migrations.js'),
    ]);
    const migrationStatus = await new Neo4jMigrationService(new Neo4jService(testDriver, 'isn-test')).getStatus();
    assertV5History(migrationStatus, migrationDefinitions, checksumMigration);
    const marker = await testSession.run(
      "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
    );
    assert.equal(asNumber(marker.records[0]?.get('version')), 5);

    stage = 'exact-schema-catalog';
    const [constraintResult, indexResult] = await runPostsPreflightQueries(dataSession, [
      'SHOW CONSTRAINTS YIELD name,type,entityType,labelsOrTypes,properties RETURN name,type,entityType,labelsOrTypes,properties',
      'SHOW INDEXES YIELD name,type,entityType,labelsOrTypes,properties,state RETURN name,type,entityType,labelsOrTypes,properties,state',
    ]);
    const constraints = constraintResult.records.map((record) => ({
      name: String(record.get('name')), type: String(record.get('type')), entityType: String(record.get('entityType')),
      labelsOrTypes: record.get('labelsOrTypes'), properties: record.get('properties'),
    }));
    const indexes = indexResult.records.filter((record) => record.get('type') !== 'LOOKUP').map((record) => ({
      name: String(record.get('name')), type: String(record.get('type')), entityType: String(record.get('entityType')),
      labelsOrTypes: record.get('labelsOrTypes'), properties: record.get('properties'), state: String(record.get('state')),
    }));
    assertV5Catalog(constraints, indexes);
    const schemaFingerprint = fingerprint({
      markerVersion: 5,
      migrations: migrationStatus.migrations,
      constraints: constraints.map((row) => [row.name, row.type, row.entityType, row.labelsOrTypes, row.properties]).sort(byName),
      indexes: indexes.map((row) => [row.name, row.type, row.entityType, row.labelsOrTypes, row.properties, row.state]).sort(byName),
    });

    stage = 'restricted-role-privileges';
    const approved = await readApprovedPrivileges();
    const [userResult, roleResult, publicResult, effectiveResult] = await runPostsPreflightQueries(systemSession, [
      "SHOW USERS YIELD user,roles,home,suspended WHERE user='isn_test_runner' RETURN user,roles,home,suspended",
      'SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS',
      'SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS',
      'SHOW USER isn_test_runner PRIVILEGES AS COMMANDS',
    ]);
    assert.equal(userResult.records.length, 1);
    assert.equal(userResult.records[0]?.get('home'), 'isn-test');
    assert.equal(userResult.records[0]?.get('suspended'), false);
    assert.deepEqual([...userResult.records[0]?.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    const role = roleResult.records.map((record) => String(record.get('command'))).sort();
    const publicRole = publicResult.records.map((record) => String(record.get('command'))).sort();
    const effective = effectiveResult.records.map((record) => String(record.get('command'))).sort();
    assertExactRestrictedPrivileges({ role, publicRole, effective }, approved);
    const privilegeFingerprint = fingerprint({ role, publicRole, effective });

    stage = 'conflicting-transactions-and-preserved-data';
    const active = await systemSession.run(
      `SHOW TRANSACTIONS YIELD database,transactionId
       WHERE database='isn-test' RETURN database,transactionId`,
    );
    assert.equal(active.records.length, 0, 'An active isn-test transaction blocks the test run.');
    const data = await capturePostsDataFingerprint(testSession);
    assert.deepEqual(data, { dataFingerprint: baseline.dataFingerprint, counts: baseline.counts });

    return {
      database: 'isn-test',
      databaseId: expectedDatabaseId,
      schemaVersion: 5,
      migrationVersions: migrationStatus.migrations.map((migration) => migration.version),
      constraintCount: constraints.length,
      indexCount: indexes.length,
      restrictedPrincipal: 'isn_test_runner',
      postPrivilegeCount: approved.filter((command) => /\bNODE Post\b|\bRELATIONSHIP AUTHORED\b/u.test(command)).length,
      deniedIsnDev: true,
      activeTransactions: 0,
      dataFingerprint: data.dataFingerprint,
      dataCounts: data.counts,
      schemaFingerprint,
      privilegeFingerprint,
      writesPerformed: false,
    };
  } catch {
    throw Object.assign(new Error(`Posts current-V5 preflight failed at ${stage}; details suppressed.`), { stage });
  } finally {
    await Promise.all([
      testSession?.close(), dataSession?.close(), systemSession?.close(),
      testDriver?.close(), adminDriver?.close(),
    ]);
  }
}

async function readAdminSettings(testUri) {
  const settings = new Map();
  for (const line of (await readFile(resolve(root, 'apps/api/.env'), 'utf8')).split(/\r?\n/u)) {
    const match = line.match(/^\s*(NEO4J_URI|NEO4J_USERNAME|NEO4J_PASSWORD|NEO4J_DATABASE)\s*=\s*(.*?)\s*$/u);
    if (match) settings.set(match[1], match[2].replace(/^(['"])(.*)\1$/u, '$2'));
  }
  const uri = settings.get('NEO4J_URI');
  assert.ok(uri && settings.get('NEO4J_USERNAME') && settings.get('NEO4J_PASSWORD'));
  assert.equal(settings.get('NEO4J_DATABASE'), 'isn-dev');
  assert.equal(uri, testUri);
  const parsed = new URL(uri);
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.port || '7687', '7687');
  return { uri, username: settings.get('NEO4J_USERNAME'), password: settings.get('NEO4J_PASSWORD') };
}

async function readApprovedPrivileges() {
  const source = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
  const match = source.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
  assert.ok(match);
  const commands = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((entry) => entry[1]);
  assert.ok(commands.length >= 70);
  assert.equal(new Set(commands).size, commands.length);
  return commands;
}

async function assertNoUnresolvedManifests() {
  const directories = [
    '.artifacts/weylume/posts-acceptance', '.artifacts/weylume/friendship-acceptance',
    '.artifacts/weylume/profile-acceptance-recovery', '.artifacts/weylume/auth-recovery',
  ];
  for (const relative of directories) {
    let entries = [];
    try { entries = await readdir(resolve(root, relative)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const unresolved = entries.filter((entry) => entry.endsWith('.tmp') ||
      (entry.endsWith('.json') && !(relative.endsWith('posts-acceptance') && entry === 'v4-preservation-baseline.json')));
    assert.deepEqual(unresolved, [], 'Unresolved fixture ownership records block new writes.');
  }
}

function hasApprovedBaselineAncestor() {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], {
      cwd: root, stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function asNumber(value) {
  return typeof value === 'number' ? value : value?.toNumber?.() ?? Number(value);
}

function byName(left, right) {
  return String(left[0]).localeCompare(String(right[0]));
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostsAcceptancePreflight().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ preflight: 'BLOCKED', stage: error?.stage ?? 'unknown', writesPerformed: false })}\n`);
    process.exitCode = 1;
  });
}
