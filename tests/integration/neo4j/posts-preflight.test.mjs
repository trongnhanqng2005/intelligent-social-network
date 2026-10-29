import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import neo4j from 'neo4j-driver';
import acceptanceSupport from '../../fixtures/friendships/acceptance-support.cjs';
import {
  capturePostsDataFingerprint,
  splitApprovedPostPrivileges,
} from '../../fixtures/posts/acceptance-support.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const databaseId = acceptanceSupport.DATABASE_ID;
const previousPreservationFingerprint = 'd5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437';
const baselinePath = resolve(root, '.artifacts/weylume/posts-acceptance/v4-preservation-baseline.json');
test('read-only Posts preflight proves the restricted isn-test V4 baseline before writes', async () => {
  assertTestEnvironment();
  await assertNoFixtureManifests();
  await assertPortsFree([3312, 5182]);

  const adminSettings = await readAdminSettings();
  const testDriver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
  );
  const adminDriver = neo4j.driver(
    adminSettings.uri,
    neo4j.auth.basic(adminSettings.username, adminSettings.password),
  );
  let stage = 'connection';
  let testSession;
  let adminSession;
  let systemSession;
  try {
    await Promise.all([testDriver.verifyConnectivity(), adminDriver.verifyConnectivity()]);
    testSession = testDriver.session({ database: 'isn-test' });
    adminSession = adminDriver.session({ database: 'isn-test' });
    systemSession = adminDriver.session({ database: 'system' });

    stage = 'restricted-identity-and-v4';
    const identity = await acceptanceSupport.verifyCurrentV4(testSession, databaseId);
    const historicalBaseline = await acceptanceSupport.captureBaseline(testSession);
    assert.equal(historicalBaseline.fingerprint, previousPreservationFingerprint,
      'The recorded V4 preservation fingerprint changed; stop before writes.');
    assert.deepEqual(historicalBaseline.counts, {
      users: 0, sessions: 0, authEvents: 2, pairs: 0, friendships: 0,
    });

    stage = 'posts-namespace';
    const postData = await capturePostsDataFingerprint(adminSession);
    assert.deepEqual(postData.counts, {
      users: historicalBaseline.counts.users,
      sessions: historicalBaseline.counts.sessions,
      authEvents: historicalBaseline.counts.authEvents,
      pairs: historicalBaseline.counts.pairs,
      friendships: historicalBaseline.counts.friendships,
      posts: 0,
      authored: 0,
    }, 'Unexpected Post/AUTHORED records or application-data count drift found.');
    const v5Rows = await testSession.run(
      'MATCH (migration:ISNSchemaMigration {version: 5}) RETURN migration.name AS name, migration.checksum AS checksum, migration.status AS status',
    );
    assert.equal(v5Rows.records.length, 0, 'V5 history already exists; inspect before applying anything.');
    const constraints = await adminSession.run(
      'SHOW CONSTRAINTS YIELD name, labelsOrTypes RETURN name, labelsOrTypes',
    );
    const indexes = await adminSession.run(
      'SHOW INDEXES YIELD name, labelsOrTypes RETURN name, labelsOrTypes',
    );
    for (const record of [...constraints.records, ...indexes.records]) {
      const labels = record.get('labelsOrTypes');
      assert.equal(Array.isArray(labels) && labels.some((label) => label === 'Post' || label === 'AUTHORED'), false,
        'Reserved Post/AUTHORED schema object exists before V5.');
    }

    stage = 'server-and-role-privileges';
    const adminPrincipal = await systemSession.run(
      'CALL dbms.showCurrentUser() YIELD username RETURN username',
    );
    assert.equal(adminPrincipal.records[0]?.get('username'), adminSettings.username,
      'The local admin credential did not authenticate as its configured identity.');
    const server = await systemSession.run(
      'CALL dbms.components() YIELD versions, edition RETURN versions[0] AS version, edition',
    );
    assert.equal(server.records[0]?.get('version'), '2026.09.0');
    assert.equal(server.records[0]?.get('edition'), 'enterprise');
    const postPrivilegesCurrentlyGranted = await assertCurrentPrivileges(systemSession);
    const active = await systemSession.run(
      `SHOW TRANSACTIONS YIELD database, transactionId, currentQuery
       WHERE database='isn-test' RETURN database, transactionId, currentQuery`,
    );
    assert.equal(active.records.length, 0, 'An active isn-test transaction blocks the write window.');

    stage = 'denied-isn-dev';
    const devSession = testDriver.session({ database: 'isn-dev' });
    try {
      await assert.rejects(devSession.run('CALL db.ping()'), (error) =>
        /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    } finally {
      await devSession.close();
    }

    stage = 'durable-baseline';
    const baseline = {
      version: 1,
      database: 'isn-test',
      databaseId,
      capturedAt: new Date().toISOString(),
      v4PreservationFingerprint: historicalBaseline.fingerprint,
      dataFingerprint: postData.dataFingerprint,
      counts: postData.counts,
    };
    await persistOrVerifyBaseline(baseline);
    console.log(JSON.stringify({
      scenario: 'ISN-C-POSTS-V4-READ-ONLY-PREFLIGHT',
      database: 'isn-test',
      databaseId: identity.databaseId,
      principal: 'isn_test_runner',
      roles: ['PUBLIC', 'isn_test_runner_role'],
      migrationVersions: [1, 2, 3, 4],
      v4PreservationFingerprint: historicalBaseline.fingerprint,
      dataFingerprint: postData.dataFingerprint,
      baselineCounts: postData.counts,
      postPrivilegesCurrentlyGranted,
      approvedPostPrivilegeDelta: splitApprovedPostPrivileges(await readApprovedPrivileges()).posts.length,
      deniedIsnDev: true,
      activeIsnTestTransactions: active.records.length,
      portsAvailable: [3312, 5182],
      writesPerformed: false,
    }));
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : 'unknown';
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'none';
    console.error(JSON.stringify({ scenario: 'ISN-C-POSTS-V4-READ-ONLY-PREFLIGHT', stage, failureName: name, failureCode: code }));
    assert.fail(`Posts read-only preflight failed at ${stage}; database and credential details are suppressed.`);
  } finally {
    await Promise.all([
      testSession?.close(), adminSession?.close(), systemSession?.close(),
      testDriver.close(), adminDriver.close(),
    ]);
  }
});

async function assertCurrentPrivileges(systemSession) {
  const { existing, posts } = splitApprovedPostPrivileges(await readApprovedPrivileges());
  assert.equal(posts.length, 14, 'Approved Post privilege scope changed; inspect before provisioning.');
  const roleRows = await systemSession.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
  const rolePrivileges = roleRows.records.map((record) => String(record.get('command'))).sort();
  const postPrivilegeCount = rolePrivileges.filter((command) => /\bNODE Post\b|\bRELATIONSHIP AUTHORED\b/u.test(command)).length;
  assert.ok(postPrivilegeCount === 0 || postPrivilegeCount === posts.length,
    'Post grants must be either entirely absent or the exact approved delta.');
  assert.deepEqual(rolePrivileges, [...existing, ...(postPrivilegeCount ? posts : [])].sort(),
    'Current role differs from the exact approved V4 or V4+Post privilege set.');

  const publicRows = await systemSession.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS');
  const publicPrivileges = publicRows.records.map((record) => String(record.get('command'))).sort();
  assert.equal(publicPrivileges.some((command) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(command)), false,
    'PUBLIC has an unapproved database or graph privilege.');
  const effective = await systemSession.run('SHOW USER isn_test_runner PRIVILEGES AS COMMANDS');
  const expectedEffective = [...rolePrivileges, ...publicPrivileges]
    .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'))
    .sort();
  assert.deepEqual(effective.records.map((record) => String(record.get('command'))).sort(), expectedEffective,
    'Effective test-user privileges differ from the role plus inherited PUBLIC privileges.');
  return postPrivilegeCount;
}

async function readApprovedPrivileges() {
  const source = await readFile(resolve(root, 'apps/api/scripts/provision-test-user.mjs'), 'utf8');
  const match = source.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
  assert.ok(match, 'Approved restricted-role privilege manifest was not found.');
  const commands = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((item) => item[1]);
  assert.ok(commands.length >= 70);
  assert.equal(new Set(commands).size, commands.length);
  return commands;
}

async function readAdminSettings() {
  const path = resolve(root, 'apps/api/.env');
  const values = new Map();
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/u)) {
    const match = line.match(/^\s*(NEO4J_URI|NEO4J_USERNAME|NEO4J_PASSWORD|NEO4J_DATABASE)\s*=\s*(.*?)\s*$/u);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\1$/u, '$2'));
  }
  const uri = values.get('NEO4J_URI');
  assert.ok(uri && values.get('NEO4J_USERNAME') && values.get('NEO4J_PASSWORD'));
  assert.equal(values.get('NEO4J_DATABASE'), 'isn-dev');
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'neo4j:');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '7687');
  assert.equal(uri, process.env.NEO4J_URI, 'Admin and restricted identities must use the same approved local runtime.');
  return { uri, username: values.get('NEO4J_USERNAME'), password: values.get('NEO4J_PASSWORD') };
}

function assertTestEnvironment() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD);
  assert.equal(process.env.NEO4J_TEST_USERNAME, 'isn_test_runner');
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD,
    'The restricted test process must not inherit development credentials.');
  const uri = new URL(process.env.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.port, '7687');
  assert.equal(normalizePath(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()), normalizePath(root));
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'feature/posts-feed');
  execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], {
    cwd: root, stdio: 'ignore',
  });
}

async function assertNoFixtureManifests() {
  const locations = [
    resolve(root, '.artifacts/weylume/friendship-acceptance'),
    resolve(root, '.artifacts/weylume/profile-acceptance-recovery'),
    resolve(root, '.artifacts/weylume/auth-recovery'),
    resolve(root, '.artifacts/weylume/posts-acceptance'),
  ];
  for (const directory of locations) {
    let names = [];
    try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const unresolved = names.filter((name) => {
      if (directory === resolve(root, '.artifacts/weylume/posts-acceptance') && name === 'v4-preservation-baseline.json') return false;
      return name.endsWith('.json') || name.endsWith('.tmp');
    });
    assert.deepEqual(unresolved, [], `Unresolved fixture ownership artifact exists under ${directory}.`);
  }
}

async function assertPortsFree(ports) {
  for (const port of ports) {
    const server = createServer();
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolveListen);
    });
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

async function persistOrVerifyBaseline(baseline) {
  await import('node:fs/promises').then(({ mkdir }) => mkdir(resolve(root, '.artifacts/weylume/posts-acceptance'), { recursive: true }));
  let prior;
  try { prior = JSON.parse(await readFile(baselinePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior) {
    assert.deepEqual({ ...prior, capturedAt: baseline.capturedAt }, baseline,
      'An earlier Posts preservation baseline differs; inspect its ownership before proceeding.');
    return;
  }
  await writeFile(baselinePath, JSON.stringify(baseline), { flag: 'wx', mode: 0o600 });
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
}
