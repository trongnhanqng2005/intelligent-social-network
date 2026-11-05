import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import neo4j from 'neo4j-driver';
import { assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';
import { createActivityBundle, publishSnapshot } from '../../../apps/api/scripts/activity-export.mjs';
import friendshipSupport from '../../fixtures/friendships/acceptance-support.cjs';
import { capturePostsDataFingerprint } from '../../fixtures/posts/acceptance-support.mjs';

const DAY = 86_400_000;

test('activity operator exports pseudonymous rows and purges/erases only intended activity', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD);
  assert.equal(process.env.NEO4J_TEST_USERNAME, 'isn_test_runner');
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD);
  assert.equal(process.env.ACTIVITY_CAPTURE_ENABLED, 'true');
  assertPostsWriteWindow();

  const ids = { userId: randomUUID(), recentId: randomUUID(), oldId: randomUUID(), authId: randomUUID() };
  const email = `activity-${ids.userId}@example.invalid`;
  const marker = `activity fixture ${randomUUID()}`;
  const work = await mkdtemp(path.join(tmpdir(), 'isn-activity-operator-'));
  const store = path.join(work, 'store');
  await mkdir(store, { mode: 0o700 });
  if (process.platform === 'win32') {
    await setPrivateWindowsAcl(work);
    await setPrivateWindowsAcl(store);
  }
  const manifestPath = path.join(work, 'fixture-manifest.json');
  await writeFile(manifestPath, JSON.stringify({ version: 1, database: 'isn-test', ...ids, email }), { flag: 'wx', mode: 0o600 });
  const keyPath = path.join(work, 'key.bin');
  const secret = randomBytes(32);
  await writeFile(keyPath, secret, { flag: 'wx', mode: 0o600 });

  const env = { ...process.env, NODE_ENV: 'test', NEO4J_DATABASE: 'isn-test',
    NEO4J_TEST_USERNAME: 'isn_test_runner', ACTIVITY_CAPTURE_ENABLED: 'true',
    ISN_TEST_WRITE_WINDOW: 'owner-approved', ACTIVITY_KEY_VERSION: 'operator-test-v1' };
  const driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_TEST_USERNAME, env.NEO4J_TEST_PASSWORD));
  const session = driver.session({ database: 'isn-test' });
  let baseline;
  let fixtureWritten = false;
  let success = false;
  try {
    const identity = (await session.run('CALL db.info() YIELD name,id RETURN name,id')).records[0];
    assert.equal(identity?.get('name'), 'isn-test');
    assert.equal(identity?.get('id'), friendshipSupport.DATABASE_ID);
    const principal = (await session.run('CALL dbms.showCurrentUser() YIELD username,roles RETURN username,roles')).records[0];
    assert.equal(principal?.get('username'), 'isn_test_runner');
    assert.deepEqual([...principal.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
    const denied = driver.session({ database: 'isn-dev', defaultAccessMode: neo4j.session.READ });
    try { await assert.rejects(denied.run('CALL db.ping()'), (error) => /^Neo\.ClientError\.Security\./u.test(String(error?.code ?? ''))); }
    finally { await denied.close(); }
    const initial = await session.run('MATCH (event:ActivityEvent) RETURN count(event) AS count');
    assert.equal(initial.records[0].get('count').toNumber(), 0, 'Acceptance requires an empty ActivityEvent baseline');
    const { Neo4jService } = await import('../../../apps/api/dist/neo4j/neo4j.service.js');
    const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    const schema = await new Neo4jMigrationService(new Neo4jService(driver, 'isn-test')).getStatus();
    assert.equal(schema.status, 'current');
    assert.equal(schema.version, 7);
    baseline = await capturePostsDataFingerprint(session);
    const conflict = await session.run('MATCH (record) WHERE (record:User AND (record.id = $id OR record.email = $email)) OR (record:ActivityEvent AND record.eventId IN $events) OR (record:AuthActivityEvent AND record.eventId = $authId) RETURN count(record) AS count',
      { id: ids.userId, email, events: [ids.recentId, ids.oldId], authId: ids.authId });
    assert.equal(conflict.records[0].get('count').toNumber(), 0);

    const now = Date.now();
    const recent = new Date(now - DAY).toISOString();
    const old = new Date(now - 31 * DAY).toISOString();
    await session.run(`CREATE (user:User {id:$id,email:$email,displayName:$name,displayNameSearch:$search,
      createdAt:datetime($recent),updatedAt:datetime($recent),profileCreatedAt:datetime($recent),
      profileUpdatedAt:datetime($recent),profileVersion:0})
      CREATE (:ActivityEvent {eventId:$recentId,schemaVersion:1,eventType:'POST_CREATED',occurredAt:datetime($recent),source:'APPLICATION',actorId:$id,objectType:'POST',objectId:$objectId})
      CREATE (:ActivityEvent {eventId:$oldId,schemaVersion:1,eventType:'POST_CREATED',occurredAt:datetime($old),source:'APPLICATION',actorId:$id,objectType:'POST',objectId:$oldObjectId})
      CREATE (auth:AuthActivityEvent {eventId:$authId,schemaVersion:1,eventType:'AUTH_LOGIN_SUCCEEDED',timestamp:datetime($recent),source:'APPLICATION',userId:$id,sessionId:$sessionId})
      CREATE (user)-[:PERFORMED_AUTH_EVENT]->(auth)`, { ...ids, email, name: marker, search: marker.toLowerCase(), recent, old,
      id: ids.userId, objectId: randomUUID(), oldObjectId: randomUUID(), sessionId: randomUUID() });
    fixtureWritten = true;

    const { runOperator } = await import('../../../apps/api/scripts/activity-operator.mjs');
    const from = new Date(now - 2 * DAY).toISOString();
    const to = new Date(now - 60_000).toISOString();
    await runOperator({ command: 'export', options: { '--from': from, '--to': to, '--max': '10', '--key-file': keyPath,
      '--snapshot-dir': store, '--label': 'Acceptance', } }, env);
    const filesAfterExport = (await readdir(store)).filter((name) => name.endsWith('.json'));
    assert.equal(filesAfterExport.length, 1);
    const exportedText = await readFile(path.join(store, filesAfterExport[0]), 'utf8');
    const exported = JSON.parse(exportedText);
    assert.equal(exported.rows.length, 2);
    assert.ok(exported.rows.every((row) => row.source === 'APPLICATION' && /^[a-f0-9]{64}$/u.test(row.eventId) && /^[a-f0-9]{64}$/u.test(row.actorId)));
    for (const forbidden of [ids.userId, ids.recentId, ids.authId, ids.oldId, email, marker]) assert.equal(exportedText.includes(forbidden), false);
    const auth = await session.run('MATCH (event:AuthActivityEvent {eventId:$id}) RETURN event.sessionId AS id', { id: ids.authId });
    assert.equal(exportedText.includes(auth.records[0].get('id')), false, 'sessionId must never be exported');

    const historicalFrom = new Date(now - 32 * DAY).toISOString();
    const historicalTo = new Date(now - 31 * DAY).toISOString();
    const historical = createActivityBundle([], { from: historicalFrom, to: historicalTo, sourceWatermark: historicalTo, secret, keyVersion: env.ACTIVITY_KEY_VERSION,
      mode: 'APPLICATION', createdAt: new Date(now - 31.5 * DAY).toISOString() });
    const historicalPath = await publishSnapshot(store, historical);
    await runOperator({ command: 'purge', options: { '--snapshot-dir': store } }, env);
    assert.equal((await session.run('MATCH (event:ActivityEvent {eventId:$id}) RETURN count(event) AS count', { id: ids.oldId })).records[0].get('count').toNumber(), 0);
    await assert.rejects(readFile(historicalPath), { code: 'ENOENT' });
    assert.equal((await session.run('MATCH (event:AuthActivityEvent {eventId:$id}) RETURN count(event) AS count', { id: ids.authId })).records[0].get('count').toNumber(), 1);

    await session.run('MATCH (user:User {id:$id,email:$email})-[link:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent {eventId:$authId}) DELETE link', { ...ids, id: ids.userId, email });
    await session.run('MATCH (user:User {id:$id,email:$email}) DELETE user', { ...ids, id: ids.userId, email });
    const beforeAbsentExport = new Set(await readdir(store));
    await runOperator({ command: 'export', options: { '--from': from, '--to': to, '--max': '10', '--key-file': keyPath,
      '--snapshot-dir': store } }, env);
    const absentExport = (await readdir(store)).find((name) => name.endsWith('.json') && !beforeAbsentExport.has(name));
    assert.ok(absentExport, 'The second export must publish a new empty-account snapshot');
    const absentBundle = JSON.parse(await readFile(path.join(store, absentExport), 'utf8'));
    assert.equal(absentBundle.rows.length, 0, 'Absent account must contribute no export rows');
    const erasedPath = await publishSnapshot(store, createActivityBundle([
      { eventId: ids.recentId, schemaVersion: 1, eventType: 'POST_CREATED', occurredAt: recent, source: 'APPLICATION', actorId: ids.userId, objectType: 'POST', objectId: 'fixture-post' },
    ], { from, to, sourceWatermark: to, secret, keyVersion: env.ACTIVITY_KEY_VERSION, mode: 'APPLICATION' }));
    const expiredMatching = await publishSnapshot(store, createActivityBundle([
      { eventId: ids.oldId, schemaVersion: 1, eventType: 'POST_CREATED', occurredAt: old, source: 'APPLICATION', actorId: ids.userId, objectType: 'POST', objectId: 'fixture-post' },
    ], { from: old, to: new Date(now - 30 * DAY - 1).toISOString(), sourceWatermark: old, secret,
      keyVersion: env.ACTIVITY_KEY_VERSION, mode: 'APPLICATION', createdAt: new Date(now - 31 * DAY).toISOString() }));
    await runOperator({ command: 'erase', options: { '--snapshot-dir': store, '--key-file': keyPath, '--user-id': ids.userId } }, env);
    await assert.rejects(readFile(erasedPath), { code: 'ENOENT' });
    await assert.rejects(readFile(expiredMatching), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(store, filesAfterExport[0])), { code: 'ENOENT' });
    assert.equal((await session.run('MATCH (event:AuthActivityEvent {eventId:$id}) RETURN count(event) AS count', { id: ids.authId })).records[0].get('count').toNumber(), 1);
    assert.equal((await session.run('MATCH (event:ActivityEvent {eventId:$id}) RETURN count(event) AS count', { id: ids.recentId })).records[0].get('count').toNumber(), 0);
    success = true;
  } finally {
    if (fixtureWritten || !success) {
      const ownership = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.deepEqual(ownership, { version: 1, database: 'isn-test', ...ids, email });
      await session.run('MATCH (event:ActivityEvent) WHERE event.eventId IN $ids AND event.actorId = $userId DELETE event',
        { ids: [ids.recentId, ids.oldId], userId: ids.userId });
      await session.run('MATCH (user:User {id:$userId,email:$email})-[link:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent {eventId:$eventId,userId:$userId}) DELETE link',
        { userId: ids.userId, email, eventId: ids.authId });
      await session.run('MATCH (event:AuthActivityEvent {eventId:$eventId,userId:$userId}) WHERE NOT (()-[:PERFORMED_AUTH_EVENT]->(event)) DELETE event',
        { userId: ids.userId, eventId: ids.authId });
      await session.run('MATCH (user:User {id:$userId,email:$email}) WHERE NOT (user)-[]-() DELETE user', { userId: ids.userId, email });
    }
    if (baseline) assert.deepEqual(await capturePostsDataFingerprint(session), baseline, 'Database fingerprint must match baseline');
    await session.close();
    await driver.close();
    if (success) {
      for (const name of await readdir(store)) await unlink(path.join(store, name));
      await rmdir(store);
      await unlink(keyPath);
      await unlink(manifestPath);
      await rmdir(work);
    }
  }
});

async function setPrivateWindowsAcl(directory) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.Directory]::GetAccessControl($env:ISN_ACTIVITY_TEST_DIR); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:ISN_ACTIVITY_TEST_DIR,$acl)"],
  { env: { ...process.env, ISN_ACTIVITY_TEST_DIR: directory }, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Private temp ACL setup failed: ${result.stderr}`);
}
