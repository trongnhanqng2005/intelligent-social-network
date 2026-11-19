import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import acceptanceSupport from '../../fixtures/friendships/acceptance-support.cjs';

const { assertTestEnvironment, captureBaseline, verifyCurrentV4 } = acceptanceSupport;

const root = assertTestEnvironment();
const expectedPrivilegeSource = resolve(root, 'apps/api/scripts/provision-test-user.mjs');
const expectedRolePrivileges = readApprovedPrivileges(await readFile(expectedPrivilegeSource, 'utf8'));
const approvedAdmin = await readAdminSettings();
assert.equal(approvedAdmin.uri, process.env.NEO4J_URI, 'Admin metadata check must use the approved same loopback Neo4j runtime');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(approvedAdmin.uri).hostname.replace(/^\[|\]$/gu, '')));
await assertPortsFree([3311, 5181]);
await assertNoUnknownFixtureManifests(root);

const testDriver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME, process.env.NEO4J_TEST_PASSWORD),
);
const adminDriver = neo4j.driver(
  approvedAdmin.uri,
  neo4j.auth.basic(approvedAdmin.username, approvedAdmin.password),
);
let baseline;
let verifiedIdentity;
try {
  await testDriver.verifyConnectivity();
  const session = testDriver.session({ database: 'isn-test' });
  try {
    verifiedIdentity = await verifyCurrentV4(session);
    baseline = await captureBaseline(session);
  } finally {
    await session.close();
  }

  const admin = adminDriver.session({ database: 'system' });
  try {
    const userResult = await admin.run(
      'SHOW USERS YIELD user,roles,home,suspended WHERE user=$username RETURN user,roles,home,suspended',
      { username: 'isn_test_runner' },
    );
    assert.equal(userResult.records.length, 1);
    assert.equal(userResult.records[0].get('home'), 'isn-test');
    assert.equal(userResult.records[0].get('suspended'), false);
    assert.deepEqual([...userResult.records[0].get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);

    const roleRows = await admin.run('SHOW ROLE isn_test_runner_role PRIVILEGES AS COMMANDS');
    const actualRolePrivileges = roleRows.records.map((record) => String(record.get('command'))).sort();
    assert.deepEqual(actualRolePrivileges, [...expectedRolePrivileges].sort(), 'Effective Friendship test role grants differ from the approved provisioning manifest');
    const publicRows = await admin.run('SHOW ROLE PUBLIC PRIVILEGES AS COMMANDS');
    const publicPrivileges = publicRows.records.map((record) => String(record.get('command'))).sort();
    assert.equal(publicPrivileges.some((command) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(command)), false,
      'PUBLIC adds an unapproved target-database or graph privilege');

    const effective = await admin.run('SHOW USER isn_test_runner PRIVILEGES AS COMMANDS');
    const effectivePrivileges = effective.records.map((record) => String(record.get('command'))).sort();
    const expectedEffective = [...actualRolePrivileges, ...publicPrivileges]
      .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'))
      .sort();
    assert.deepEqual(effectivePrivileges, expectedEffective,
      'Effective user privileges must equal the inspected role plus inherited PUBLIC privileges');
    const active = await admin.run(
      `SHOW TRANSACTIONS YIELD database,transactionId,currentQuery
       WHERE database='isn-test' RETURN database,transactionId,currentQuery`,
    );
    assert.equal(active.records.length, 0, 'An active isn-test transaction prevents the exclusive write window');
    const dev = testDriver.session({ database: 'isn-dev' });
    try {
      await assert.rejects(dev.run('CALL db.ping()'), (error) =>
        /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? '')));
    } finally {
      await dev.close();
    }
    console.log(JSON.stringify({
      scenario: 'FS-00-read-only-safety-gate', worktree: root, branch: 'feature/friendship-system',
      database: 'isn-test', databaseId: verifiedIdentity.databaseId,
      principal: 'isn_test_runner', rolesVerified: true,
      approvedRolePrivileges: actualRolePrivileges.length,
      inheritedPublicPrivileges: publicPrivileges.length,
      effectivePrivilegesVerified: true, devAccess: 'denied', migrationsVerified: 4,
      constraintsVerified: 11, indexesVerifiedOnline: 16, graphInvariants: 'valid',
      baseline: baseline.counts, preservationFingerprint: baseline.fingerprint,
      portsAvailable: [3311, 5181], unknownFixtureManifests: 0, activeTestTransactions: 0,
      devApplicationDataRead: false, writesPerformed: false,
    }));
  } finally {
    await admin.close();
  }
} finally {
  await Promise.all([testDriver.close(), adminDriver.close()]);
}

function readApprovedPrivileges(source) {
  const match = source.match(/const expectedPrivileges = \[([\s\S]*?)\n\];/u);
  assert.ok(match, 'Cannot locate the existing immutable approved privilege manifest');
  const commands = [...match[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gmu)].map((item) => item[1]);
  assert.ok(commands.length >= 70, 'Approved privilege manifest format/count changed; inspect before continuing');
  assert.equal(new Set(commands).size, commands.length);
  return commands;
}

async function readAdminSettings() {
  const path = resolve(root, 'apps/api/.env');
  const content = await readFile(path, 'utf8');
  const values = new Map();
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*(NEO4J_URI|NEO4J_USERNAME|NEO4J_PASSWORD)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    values.set(match[1], value);
  }
  assert.ok(values.get('NEO4J_URI') && values.get('NEO4J_USERNAME') && values.get('NEO4J_PASSWORD'),
    'Read-only effective-privilege verification requires the existing local admin config; values are not printed');
  return { uri: values.get('NEO4J_URI'), username: values.get('NEO4J_USERNAME'), password: values.get('NEO4J_PASSWORD') };
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

async function assertNoUnknownFixtureManifests(rootPath) {
  const { readdir } = await import('node:fs/promises');
  const locations = [
    [resolve(rootPath, '.artifacts/weylume/friendship-acceptance'), /^run-[0-9a-f-]{36}\.json$/iu],
    [resolve(rootPath, '.artifacts/weylume/profile-acceptance-recovery'), /^profile-account-\d+-[0-9a-f-]{36}\.json$/iu],
    [resolve(rootPath, '.artifacts/weylume/auth-recovery'), /^auth-account-\d+-[0-9a-f-]{36}\.json$/iu],
  ];
  for (const [directory, pattern] of locations) {
    let names = [];
    try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(names.filter((name) => pattern.test(name)).length, 0,
      `Unresolved fixture ownership manifest exists in ${directory}; inspect it before writes`);
  }
}
