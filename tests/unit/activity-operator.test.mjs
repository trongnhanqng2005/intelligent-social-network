import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../apps/api/scripts/activity-operator.mjs';

test('activity operator requires a supported command and validates metadata labels', () => {
  assert.deepEqual(parseArgs(['export', '--label', 'Research_2026']), {
    command: 'export', options: { '--label': 'Research_2026' },
  });
  assert.throws(() => parseArgs(['unknown']), /Usage:/u);
  assert.throws(() => parseArgs(['export', '--label', 'Activity Event']), /Invalid activity metadata label/u);
});

test('activity operator rejects missing, repeated, and unknown options', () => {
  assert.throws(() => parseArgs(['export', '--from']), /Missing value/u);
  assert.throws(() => parseArgs(['export', '--from', 'a', '--from', 'b']), /repeated/u);
  assert.throws(() => parseArgs(['export', '--unsafe', 'yes']), /Unknown/u);
});

test('Windows key ACL allowlist refuses broad and unrelated access', async () => {
  const { assertWindowsKeyAcl } = await import('../../apps/api/scripts/activity-operator.mjs');
  const currentSid = 'S-1-5-21-1-2-3-1001';
  assert.doesNotThrow(() => assertWindowsKeyAcl({ currentSid, ownerSid: currentSid, allowSids: [currentSid, 'S-1-5-18', 'S-1-5-32-544'] }));
  assert.throws(() => assertWindowsKeyAcl({ currentSid, ownerSid: currentSid, allowSids: ['S-1-1-0'] }), /outside/u);
  assert.throws(() => assertWindowsKeyAcl({ currentSid, ownerSid: 'S-1-5-21-9-9-9-9999', allowSids: [currentSid] }), /owned/u);
});

test('loads an operator-only key and rejects broadly readable keys', async () => {
  const { mkdtemp, writeFile, unlink, rmdir, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { readKey } = await import('../../apps/api/scripts/activity-operator.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'isn-activity-key-'));
  const filename = path.join(directory, 'key.bin');
  const key = Buffer.alloc(32, 7);
  try {
    await writeFile(filename, key, { mode: 0o600 });
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.File]::GetAccessControl($env:ISN_ACTIVITY_TEST_KEY); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow'); $acl.AddAccessRule($rule); [System.IO.File]::SetAccessControl($env:ISN_ACTIVITY_TEST_KEY,$acl)"],
      { env: { ...process.env, ISN_ACTIVITY_TEST_KEY: filename }, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, 'Temporary test key ACL setup must succeed: ' + result.stderr);
      assert.deepEqual(await readKey(filename), key);
      const broad = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $acl=[System.IO.File]::GetAccessControl($env:ISN_ACTIVITY_TEST_KEY); $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0'); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow'); $acl.AddAccessRule($rule); [System.IO.File]::SetAccessControl($env:ISN_ACTIVITY_TEST_KEY,$acl)"],
      { env: { ...process.env, ISN_ACTIVITY_TEST_KEY: filename }, encoding: 'utf8', windowsHide: true });
      assert.equal(broad.status, 0);
      await assert.rejects(readKey(filename), /outside/u);
    } else {
      assert.deepEqual(await readKey(filename), key);
      await chmod(filename, 0o644);
      await assert.rejects(readKey(filename), /owner-only/u);
    }
  } finally {
    await unlink(filename);
    await rmdir(directory);
  }
});

test('normalizes Neo4j integers without exposing extra record fields', async () => {
  const { normalizeActivityRows } = await import('../../apps/api/scripts/activity-operator.mjs');
  const values = { eventId: 'id', schemaVersion: { toNumber: () => 1 }, eventType: 'POST_CREATED',
    occurredAt: { toString: () => '2026-11-05T00:00:00.000Z' }, source: 'APPLICATION',
    actorId: 'actor', targetUserId: null, objectType: 'POST', objectId: 'post', password: 'private' };
  const [row] = normalizeActivityRows({ records: [{ get: (name) => values[name] }] });
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.occurredAt, '2026-11-05T00:00:00.000Z');
  assert.equal(Object.hasOwn(row, 'password'), false);
});

test('maintenance refuses an absent window before opening a connection', async () => {
  const { runOperator } = await import('../../apps/api/scripts/activity-operator.mjs');
  const env = { NODE_ENV: 'test', NEO4J_DATABASE: 'isn-test', NEO4J_URI: 'neo4j://127.0.0.1:7687',
    NEO4J_TEST_USERNAME: 'isn_test_runner', NEO4J_TEST_PASSWORD: 'synthetic', ACTIVITY_CAPTURE_ENABLED: 'true' };
  await assert.rejects(runOperator({ command: 'purge', options: {} }, env), /exclusive|Owner/u);
  await assert.rejects(runOperator({ command: 'erase', options: {} }, { ...env, NEO4J_USERNAME: 'admin' }));
});

test('requires a private snapshot directory ACL before publication', async () => {
  const { mkdtemp, rmdir, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { assertPrivateDirectory } = await import('../../apps/api/scripts/activity-operator.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'isn-activity-store-'));
  try {
    if (process.platform === 'win32') {
      const run = (command) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
        { env: { ...process.env, ISN_ACTIVITY_TEST_DIR: directory }, encoding: 'utf8', windowsHide: true });
      const setup = run("$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.Directory]::GetAccessControl($env:ISN_ACTIVITY_TEST_DIR); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:ISN_ACTIVITY_TEST_DIR,$acl)");
      assert.equal(setup.status, 0, setup.stderr);
      await assertPrivateDirectory(directory);
      const broad = run("$ErrorActionPreference='Stop'; $acl=[System.IO.Directory]::GetAccessControl($env:ISN_ACTIVITY_TEST_DIR); $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0'); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:ISN_ACTIVITY_TEST_DIR,$acl)");
      assert.equal(broad.status, 0, broad.stderr);
      await assert.rejects(assertPrivateDirectory(directory), /outside/u);
    } else {
      await chmod(directory, 0o700);
      await assertPrivateDirectory(directory);
      await chmod(directory, 0o755);
      await assert.rejects(assertPrivateDirectory(directory), /owner-only/u);
    }
  } finally { await rmdir(directory); }
});
