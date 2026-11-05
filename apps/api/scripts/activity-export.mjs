import { createHash, createHmac } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, readFile, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export const ACTIVITY_SCHEMA_VERSION = 1;
const DAY = 86_400_000;
const EVENT_TYPES = new Set([
  'AUTH_REGISTERED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT',
  'FRIEND_REQUEST_CREATED', 'FRIEND_REQUEST_ACCEPTED', 'FRIEND_REQUEST_REJECTED', 'FRIEND_REQUEST_CANCELLED', 'FRIENDSHIP_REMOVED',
  'POST_CREATED', 'POST_UPDATED', 'POST_DELETED', 'POST_LIKED', 'POST_UNLIKED',
  'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED',
]);
const OBJECT_TYPES = Object.freeze(Object.fromEntries([
  ...['AUTH_REGISTERED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT'].map((type) => [type, 'USER']),
  ...['FRIEND_REQUEST_CREATED', 'FRIEND_REQUEST_REJECTED', 'FRIEND_REQUEST_CANCELLED'].map((type) => [type, 'FRIENDSHIP_REQUEST']),
  ...['FRIEND_REQUEST_ACCEPTED', 'FRIENDSHIP_REMOVED'].map((type) => [type, 'FRIENDSHIP']),
  ...['POST_CREATED', 'POST_UPDATED', 'POST_DELETED', 'POST_LIKED', 'POST_UNLIKED'].map((type) => [type, 'POST']),
  ...['COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED'].map((type) => [type, 'COMMENT']),
]));
const canonical = (value) => JSON.stringify(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const managedName = /^activity-([a-f0-9]{64})\.json$/;
const hasExactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function validateWindow({ from, to, maxDays = 30 }) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > maxDays * DAY) {
    throw new Error('Invalid or unbounded activity snapshot window');
  }
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

function pseudonym(key, kind, value) {
  return createHmac('sha256', key).update(`isn-activity-export:v1:${kind}:${value}`).digest('hex');
}

function keyFingerprint(key) {
  return createHmac('sha256', key).update('isn-activity-export:v1:key-fingerprint').digest('hex');
}

export function pseudonymizeUser(secret, userId) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'base64');
  if (key.length < 32 || typeof userId !== 'string' || !userId) throw new Error('Missing/weak HMAC key or user ID');
  return pseudonym(key, 'user', userId);
}

function validateKeyVersion(keyVersion) {
  if (typeof keyVersion !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62}[a-zA-Z0-9])?$/.test(keyVersion)) {
    throw new Error('Invalid activity export key version');
  }
}

export function projectActivityEvents(events, { from, to, secret, keyVersion, mode }) {
  const window = validateWindow({ from, to });
  if (!['APPLICATION', 'SYNTHETIC'].includes(mode)) throw new Error('Explicit APPLICATION or SYNTHETIC mode required');
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'base64');
  if (key.length < 32) throw new Error('Missing/weak HMAC key or key version');
  validateKeyVersion(keyVersion);
  const seen = new Map(), rows = [];
  for (const event of events) {
    if (!event || !EVENT_TYPES.has(event.eventType) || event.schemaVersion !== ACTIVITY_SCHEMA_VERSION) continue;
    if (typeof event.eventId !== 'string' || !event.eventId || typeof event.actorId !== 'string' || !event.actorId) continue;
    if (mode === 'APPLICATION' && event.source !== 'APPLICATION') continue;
    if (mode === 'SYNTHETIC' && event.source !== 'SYNTHETIC') continue;
    const ms = Date.parse(event.occurredAt);
    if (!Number.isFinite(ms)) continue;
    const occurredAt = new Date(ms).toISOString();
    if (occurredAt < window.from || occurredAt >= window.to) continue;
     const objectType = OBJECT_TYPES[event.eventType];
     if (event.objectType != null && event.objectType !== objectType) continue;
     const objectId = event.objectId ?? null;
    const row = {
      eventId: pseudonym(key, 'event', event.eventId), schemaVersion: ACTIVITY_SCHEMA_VERSION,
      eventType: event.eventType, occurredAt, source: mode,
      actorId: pseudonym(key, 'user', event.actorId),
      targetUserId: event.targetUserId == null ? null : pseudonym(key, 'user', event.targetUserId),
      objectType, objectId: objectId == null ? null : pseudonym(key, `object:${objectType}`, objectId),
    };
    const identity = row.eventId, encoded = canonical(row);
    if (seen.has(identity)) {
      if (seen.get(identity) !== encoded) throw new Error(`Conflicting duplicate event: ${identity}`);
      continue;
    }
    seen.set(identity, encoded);
    rows.push(row);
  }
  rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  return rows;
}

export function createActivityBundle(events, options) {
  validateKeyVersion(options.keyVersion);
  const window = validateWindow(options);
  const providedWatermark = options.sourceWatermark ?? window.to;
  if (typeof providedWatermark !== 'string' || !Number.isFinite(Date.parse(providedWatermark))) {
    throw new Error('Invalid activity source watermark');
  }
  const sourceWatermark = new Date(Date.parse(providedWatermark)).toISOString();
  const key = Buffer.isBuffer(options.secret) ? options.secret : Buffer.from(options.secret ?? '', 'base64');
  if (key.length < 32) throw new Error('Missing/weak HMAC key or key version');
  const rows = projectActivityEvents(events, options);
  const bundle = {
    manifest: {
      schema: { version: ACTIVITY_SCHEMA_VERSION }, provenance: { mode: options.mode },
      sourceWatermark,
      window, rowCount: rows.length, keyVersion: options.keyVersion,
      keyFingerprint: keyFingerprint(key),
      createdAt: new Date(options.createdAt ?? Date.now()).toISOString(),
    },
    rows,
  };
  bundle.manifest.digest = digest(canonical(bundle));
  return bundle;
}

export function verifyActivityBundle(bundle) {
  if (!hasExactKeys(bundle, ['manifest', 'rows']) || !Array.isArray(bundle.rows) ||
    !hasExactKeys(bundle.manifest, ['schema', 'provenance', 'sourceWatermark', 'window', 'rowCount', 'keyVersion', 'keyFingerprint', 'createdAt', 'digest']) ||
    bundle.manifest.rowCount !== bundle.rows.length) return false;
  const m = bundle.manifest;
  try {
    validateKeyVersion(m.keyVersion);
    if (!hasExactKeys(m.schema, ['version']) || !hasExactKeys(m.provenance, ['mode']) ||
      m.schema.version !== ACTIVITY_SCHEMA_VERSION || !['APPLICATION', 'SYNTHETIC'].includes(m.provenance.mode) ||
      !/^[a-f0-9]{64}$/.test(m.keyFingerprint)) return false;
    if (!hasExactKeys(m.window, ['from', 'to'])) return false;
    validateWindow(m.window);
    if (typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt))) return false;
    if (typeof m.sourceWatermark !== 'string' || !Number.isFinite(Date.parse(m.sourceWatermark)) ||
      new Date(Date.parse(m.sourceWatermark)).toISOString() !== m.sourceWatermark) return false;
    for (const row of bundle.rows) {
      if (!hasExactKeys(row, ['eventId', 'schemaVersion', 'eventType', 'occurredAt', 'source', 'actorId', 'targetUserId', 'objectType', 'objectId']) ||
        !/^[a-f0-9]{64}$/.test(row.eventId) || !/^[a-f0-9]{64}$/.test(row.actorId) ||
        (row.targetUserId !== null && !/^[a-f0-9]{64}$/.test(row.targetUserId)) ||
        !EVENT_TYPES.has(row.eventType) || row.objectType !== OBJECT_TYPES[row.eventType] ||
        row.schemaVersion !== ACTIVITY_SCHEMA_VERSION || row.source !== m.provenance.mode ||
        !Number.isFinite(Date.parse(row.occurredAt)) || row.occurredAt < m.window.from || row.occurredAt >= m.window.to ||
        (row.objectId !== null && !/^[a-f0-9]{64}$/.test(row.objectId))) return false;
    }
  } catch { return false; }
  const { digest: expected, ...manifest } = bundle.manifest;
  return typeof expected === 'string' && digest(canonical({ manifest, rows: bundle.rows })) === expected;
}

export const projectAuthEvents = projectActivityEvents;

export async function publishSnapshot(directory, bundle) {
  if (!verifyActivityBundle(bundle)) throw new Error('Invalid activity bundle digest');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafeRoot(directory);
  const target = path.resolve(directory), final = path.join(target, `activity-${bundle.manifest.digest}.json`);
  const temp = path.join(target, `.activity-${process.pid}-${cryptoRandom()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${canonical(bundle)}\n`); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temp).catch(() => {}); throw error; }
  await handle.close();
  try { await link(temp, final); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
  await unlink(temp);
  return final;
}

function cryptoRandom() { return createHash('sha256').update(`${Date.now()}-${Math.random()}-${process.pid}`).digest('hex'); }

async function managedFiles(directory) {
  await assertSafeRoot(directory);
  const names = await readdir(directory);
  const files = [];
  for (const name of names) {
    if (!managedName.test(name)) continue;
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid managed activity file: ${name}`);
    const bundle = JSON.parse(await readFile(file, 'utf8'));
    if (!verifyActivityBundle(bundle) || name !== `activity-${bundle.manifest.digest}.json`) throw new Error(`Invalid managed activity bundle: ${name}`);
    files.push({ file, name, bundle });
  }
  return files;
}

export async function applyRetention(directory, now = Date.now()) {
  let removed = 0, remaining = 0;
  const files = await managedFiles(directory);
  for (const { file, bundle } of files) {
    const age = now - Date.parse(bundle.manifest.createdAt);
    if (Number.isFinite(age) && age > 30 * DAY) { await unlink(file); removed++; } else remaining++;
  }
  return { removed, remaining };
}

export async function revokeSnapshots(directory, pseudonymousActor, { secret, keyVersion }) {
  if (!/^[a-f0-9]{64}$/.test(pseudonymousActor)) throw new Error('Invalid pseudonymous actor');
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'base64');
  if (key.length < 32) throw new Error('Missing/weak HMAC key or key version');
  validateKeyVersion(keyVersion);
  let revoked = 0;
  const files = await managedFiles(directory);
  if (files.some(({ bundle }) => bundle.manifest.keyVersion !== keyVersion)) throw new Error('Activity export key version mismatch');
  if (files.some(({ bundle }) => bundle.manifest.keyFingerprint !== keyFingerprint(key))) throw new Error('Activity export key fingerprint mismatch');
  for (const { file, bundle } of files) {
    if (bundle.rows.some((row) => row.actorId === pseudonymousActor || row.targetUserId === pseudonymousActor)) {
      await unlink(file);
      revoked++;
    }
  }
  return { revoked };
}

async function assertSafeRoot(directory) {
  const absolute = path.resolve(directory);
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isDirectory() || path.resolve(await realpath(absolute)) !== absolute) {
    throw new Error('Activity snapshot root must be a real directory');
  }
}
