import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import {
  applyRetention, createActivityBundle, projectActivityEvents, pseudonymizeUser,
  publishSnapshot, revokeSnapshots, verifyActivityBundle,
} from '../../apps/api/scripts/activity-export.mjs';

const secret = Buffer.alloc(32, 7);
const window = { from: '2025-01-01T00:00:00.000Z', to: '2025-01-03T00:00:00.000Z' };
const options = { ...window, secret, keyVersion: 'operator-v1', mode: 'APPLICATION', createdAt: '2025-02-01T00:00:00.000Z', sourceWatermark: '2025-01-03T00:00:00.000Z' };
const event = (overrides = {}) => ({ eventId: 'e1', eventType: 'POST_CREATED', schemaVersion: 1, actorId: 'u1', occurredAt: '2025-01-01T12:00:00.000Z', source: 'APPLICATION', objectType: 'POST', objectId: 'p1', ...overrides });
const temp = async () => mkdtemp(path.join(os.tmpdir(), 'activity-export-'));

test('bundle output is deterministic and carries bounded window, watermark, and separate provenance/schema', () => {
  const first = createActivityBundle([event()], options);
  assert.deepEqual(first, createActivityBundle([event()], options));
  assert.equal(first.manifest.sourceWatermark, options.sourceWatermark);
  assert.deepEqual(first.manifest.window, window);
  assert.deepEqual(first.manifest.provenance, { mode: 'APPLICATION' });
  assert.deepEqual(first.manifest.schema, { version: 1 });
});

test('projects only the strict allowlist, event-specific object types, and isolates HMAC domains', () => {
  const row = projectActivityEvents([event({ privateField: 'do not copy', objectType: 'arbitrary' }), event()], options)[0];
  assert.deepEqual(Object.keys(row).sort(), ['actorId', 'eventId', 'eventType', 'objectId', 'objectType', 'occurredAt', 'schemaVersion', 'source', 'targetUserId'].sort());
  assert.equal(row.objectType, 'POST');
  assert.equal(row.actorId, pseudonymizeUser(secret, 'u1'));
  assert.notEqual(row.eventId, row.actorId);
  assert.equal(pseudonymizeUser(secret, 'u1'), createHmac('sha256', secret).update('isn-activity-export:v1:user:u1').digest('hex'));
});

test('maps friendship event types to the capture object types', () => {
  const friendshipTypes = [
    ['FRIEND_REQUEST_CREATED', 'FRIENDSHIP_REQUEST'],
    ['FRIEND_REQUEST_REJECTED', 'FRIENDSHIP_REQUEST'],
    ['FRIEND_REQUEST_CANCELLED', 'FRIENDSHIP_REQUEST'],
    ['FRIEND_REQUEST_ACCEPTED', 'FRIENDSHIP'],
    ['FRIENDSHIP_REMOVED', 'FRIENDSHIP'],
  ];
  for (const [eventType, objectType] of friendshipTypes) {
    const row = projectActivityEvents([event({ eventType, objectType })], options)[0];
    assert.equal(row.objectType, objectType, eventType);
  }
});

test('uses canonical UTC watermarks and rejects arbitrary timestamp text', () => {
  assert.equal(createActivityBundle([], { ...options, sourceWatermark: undefined }).manifest.sourceWatermark, window.to);
  assert.throws(() => createActivityBundle([], { ...options, sourceWatermark: 'tomorrow' }), /watermark/i);
  assert.equal(createActivityBundle([], { ...options, sourceWatermark: '2025-01-03T01:00:00+01:00' }).manifest.sourceWatermark, window.to);
});

test('rejects extra row and manifest fields even with a recomputed digest', () => {
  for (const mutate of [
    (bundle) => { bundle.rows[0].unexpected = 'extra'; },
    (bundle) => { bundle.manifest.unexpected = 'extra'; },
    (bundle) => { bundle.manifest.provenance.unexpected = 'extra'; },
  ]) {
    const bundle = createActivityBundle([event()], options);
    mutate(bundle);
    const { digest: _digest, ...manifest } = bundle.manifest;
    bundle.manifest.digest = createHash('sha256').update(JSON.stringify({ manifest, rows: bundle.rows })).digest('hex');
    assert.equal(verifyActivityBundle(bundle), false);
  }
});

test('supports both source modes and deduplicates identical IDs while rejecting conflicts', () => {
  assert.equal(projectActivityEvents([event(), event()], options).length, 1);
  assert.throws(() => projectActivityEvents([event(), event({ occurredAt: '2025-01-02T00:00:00.000Z' })], options), /Conflicting duplicate/);
  assert.equal(projectActivityEvents([event({ source: 'SYNTHETIC' })], { ...options, mode: 'SYNTHETIC' }).length, 1);
  assert.equal(projectActivityEvents([event({ source: 'SYNTHETIC' })], options).length, 0);
});

test('rejects unsafe key versions', () => {
  assert.throws(() => createActivityBundle([], { ...options, keyVersion: '../key' }), /key version/);
});

test('retention deletes actual expired managed snapshot files', async (t) => {
  const directory = await temp(); t.after(() => rm(directory, { recursive: true, force: true }));
  const expired = createActivityBundle([event()], { ...options, createdAt: '2024-01-01T00:00:00.000Z' });
  const fresh = createActivityBundle([event({ eventId: 'e2' })], { ...options, createdAt: '2025-02-01T00:00:00.000Z' });
  const expiredFile = await publishSnapshot(directory, expired);
  const freshFile = await publishSnapshot(directory, fresh);
  assert.deepEqual(await applyRetention(directory, Date.parse('2025-02-02T00:00:00.000Z')), { removed: 1, remaining: 1 });
  await assert.rejects(readFile(expiredFile));
  assert.equal((await readFile(freshFile, 'utf8')).length > 0, true);
});

test('revokes snapshots matching either actor or target and refuses key-version mismatch', async (t) => {
  const directory = await temp(); t.after(() => rm(directory, { recursive: true, force: true }));
  const actor = pseudonymizeUser(secret, 'u1'), target = pseudonymizeUser(secret, 'u2');
  await publishSnapshot(directory, createActivityBundle([event({ targetUserId: 'u2' })], options));
  assert.deepEqual(await revokeSnapshots(directory, target, { secret, keyVersion: 'operator-v1' }), { revoked: 1 });
  await publishSnapshot(directory, createActivityBundle([event()], options));
  await assert.rejects(revokeSnapshots(directory, actor, { secret, keyVersion: 'other-v1' }), /key version mismatch/);
  assert.equal((await readdir(directory)).length, 1);
  assert.deepEqual(await revokeSnapshots(directory, actor, { secret, keyVersion: 'operator-v1' }), { revoked: 1 });
});

test('refuses revocation with a different key before deleting any matching snapshot', async (t) => {
  const directory = await temp(); t.after(() => rm(directory, { recursive: true, force: true }));
  await publishSnapshot(directory, createActivityBundle([event()], options));
  const wrongSecret = Buffer.alloc(32, 8);
  await assert.rejects(revokeSnapshots(directory, pseudonymizeUser(wrongSecret, 'u1'), { secret: wrongSecret, keyVersion: 'operator-v1' }), /fingerprint/i);
  assert.equal((await readdir(directory)).length, 1);
});

test('rejects malformed managed bundles before deleting any snapshot', async (t) => {
  const directory = await temp(); t.after(() => rm(directory, { recursive: true, force: true }));
  const expired = createActivityBundle([event()], { ...options, createdAt: '2024-01-01T00:00:00.000Z' });
  await publishSnapshot(directory, expired);
  await writeFile(path.join(directory, `activity-${'a'.repeat(64)}.json`), '{broken');
  await assert.rejects(applyRetention(directory, Date.parse('2025-02-02T00:00:00.000Z')));
  assert.equal((await readdir(directory)).length, 2);
});

test('refuses symlink snapshot roots and managed-file symlinks', async (t) => {
  const parent = await temp(), outside = await temp(); t.after(async () => { await rm(parent, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const rootLink = path.join(parent, 'root-link');
  await symlink(outside, rootLink, 'junction');
  await assert.rejects(applyRetention(rootLink), /real directory/);
  const valid = createActivityBundle([event()], options);
  const name = `activity-${valid.manifest.digest}.json`;
  await symlink(path.join(outside, 'victim'), path.join(outside, name), 'file');
  await assert.rejects(revokeSnapshots(outside, pseudonymizeUser(secret, 'u1'), { secret, keyVersion: 'operator-v1' }));
});
