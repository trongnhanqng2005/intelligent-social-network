import assert from 'node:assert/strict';
import { lstat, readFile, realpath, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import neo4j from 'neo4j-driver';
import { assertPostsTestTarget, assertPostsWriteWindow } from './posts-operation-safety.mjs';
import {
  ACTIVITY_SCHEMA_VERSION, createActivityBundle, publishSnapshot, applyRetention,
  revokeSnapshots, pseudonymizeUser,
} from './activity-export.mjs';
import friendshipSupport from '../../../tests/fixtures/friendships/acceptance-support.cjs';

const DAY = 86_400_000;
const MAX_BATCH = 500;
const AUTH_TYPES = new Set(['AUTH_REGISTERED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT']);
const EVENT_FIELDS = 'event.eventId AS eventId, event.schemaVersion AS schemaVersion, event.eventType AS eventType, event.occurredAt AS occurredAt, event.source AS source, event.actorId AS actorId, event.targetUserId AS targetUserId, event.objectType AS objectType, event.objectId AS objectId';

export function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index];
    if (!['--from', '--to', '--max', '--key-file', '--snapshot-dir', '--label', '--user-id'].includes(name) || options[name]) {
      throw new Error(`Unknown or repeated option: ${name}`);
    }
    options[name] = rest[++index];
    if (!options[name] || options[name].startsWith('--')) throw new Error(`Missing value for ${name}`);
  }
  if (!['export', 'purge', 'erase', 'maintenance'].includes(command)) {
    throw new Error('Usage: activity-operator.mjs <export|purge|erase|maintenance> [options]');
  }
  if (options['--label'] && !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(options['--label'])) {
    throw new Error('Invalid activity metadata label');
  }
  return { command, options };
}

export async function readKey(filename) {
  if (!path.isAbsolute(filename ?? '')) throw new Error('--key-file must be an absolute path');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Activity key must be a regular, non-symlink file');
  const keyPath = await realpath(filename);
  const repository = await realpath(fileURLToPath(new URL('../../../', import.meta.url)));
  const relative = path.relative(repository, keyPath);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Activity key must be outside the repository');
  }
  await assertPrivateAcl(filename, info);
  const key = await readFile(filename);
  if (key.length < 32) throw new Error('Activity key must contain at least 32 bytes');
  return key;
}

export async function assertPrivateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Activity store must be a real directory');
  await assertPrivateAcl(directory, info);
}

async function assertPrivateAcl(filename, info) {
  if (process.platform === 'win32') {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $acl=[System.IO.File]::GetAccessControl($env:ISN_ACTIVITY_KEY_PATH); @{ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; allowSids=@($acl.Access | Where-Object AccessControlType -eq Allow | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value})} | ConvertTo-Json -Compress"],
    { env: { ...process.env, ISN_ACTIVITY_KEY_PATH: filename }, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (probe.status !== 0) throw new Error('Cannot verify activity key ACL');
    assertWindowsKeyAcl(JSON.parse(probe.stdout));
  }
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('Activity path file permissions must be owner-only');

}

export function assertWindowsKeyAcl({ ownerSid, currentSid, allowSids }) {
  if (!/^S-1-5-21-/u.test(currentSid ?? '') || ![currentSid, 'S-1-5-18', 'S-1-5-32-544'].includes(ownerSid) || !Array.isArray(allowSids)) {
    throw new Error('Activity path must be owned by the operator or system administrators');
  }
  const allowed = new Set([currentSid, 'S-1-5-18', 'S-1-5-32-544']);
  if (allowSids.some((sid) => !allowed.has(sid))) throw new Error('Activity path ACL grants access outside the operator and system administrators');
}

function targetFromEnvironment(env) {
  assertPostsTestTarget(env);
  assert.equal(env.ACTIVITY_CAPTURE_ENABLED, 'true', 'ACTIVITY_CAPTURE_ENABLED=true is required');
  const uri = new URL(env.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(uri.hostname), 'Only loopback Neo4j is allowed');
  assert.equal(uri.port || '7687', '7687');
  return { uri: env.NEO4J_URI, username: env.NEO4J_TEST_USERNAME, password: env.NEO4J_TEST_PASSWORD };
}

async function verifyTestAccess(driver, session) {
  const info = await session.run('CALL db.info() YIELD name, id RETURN name, id');
  const identity = info.records[0];
  if (identity?.get('name') !== 'isn-test' || identity.get('id') !== friendshipSupport.DATABASE_ID) throw new Error('Authenticated isn-test database UUID verification failed');
  const current = await session.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
  const principal = current.records[0];
  assert.equal(principal?.get('username'), 'isn_test_runner', 'Authenticated principal mismatch');
  assert.deepEqual([...principal.get('roles')].sort(), ['PUBLIC', 'isn_test_runner_role']);
  const dev = driver.session({ database: 'isn-dev' });
  try {
    await dev.run('CALL db.ping()');
    throw new Error('Restricted test principal unexpectedly accessed isn-dev');
  } catch (error) {
    if (error.message === 'Restricted test principal unexpectedly accessed isn-dev' ||
        !String(error?.code ?? '').startsWith('Neo.ClientError.Security.')) throw error;
  } finally { await dev.close(); }
  const { Neo4jMigrationService } = await import('../dist/neo4j/neo4j-migrations.js');
  const status = await new Neo4jMigrationService({
    database: 'isn-test', executeRead: (work) => session.executeRead(work),
  }).getStatus();
  if (status.status !== 'current' || status.version !== 7) throw new Error('Verified current V7 history and catalog are required');
  return String(identity.get('id'));
}

export function normalizeActivityRows(result) {
  return result.records.map((record) => Object.fromEntries([
    'eventId', 'schemaVersion', 'eventType', 'occurredAt', 'source', 'actorId',
    'targetUserId', 'objectType', 'objectId',
  ].map((field) => {
    const value = record.get(field);
    return [field, field === 'occurredAt' && value != null ? value.toString() :
      field === 'schemaVersion' && value != null && typeof value.toNumber === 'function' ? value.toNumber() : value];
  })));
}

export async function runOperator({ command, options }, env = process.env) {
  const { uri, username, password } = targetFromEnvironment(env);
  if (command === 'maintenance' || command === 'purge' || command === 'erase') assertPostsWriteWindow(env);
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    const session = driver.session({ database: 'isn-test' });
    try {
      const databaseUuid = await verifyTestAccess(driver, session);
      const requestedDirectory = options['--snapshot-dir'];
      if (!requestedDirectory || !path.isAbsolute(requestedDirectory)) throw new Error('--snapshot-dir must be an explicit absolute path');
      const directory = await realpath(requestedDirectory);
      await assertPrivateDirectory(directory);
      const root = await realpath(fileURLToPath(new URL('../../../', import.meta.url)));
      const relative = path.relative(root, directory);
      if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Snapshot directory must be outside the repository');
      let lock;
      try { lock = await open(path.join(directory, '.lock'), 'wx', 0o600); }
      catch { throw new Error('Activity directory is locked or has a stale lock'); }
      try {
      if (command === 'export') {
        const from = options['--from'], to = options['--to'];
        if (!from || !to) throw new Error('Export requires explicit --from and --to UTC timestamps');
        const start = Date.parse(from), end = Date.parse(to);
        if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString() !== from ||
            new Date(end).toISOString() !== to || start >= end || end - start > 30 * DAY) {
          throw new Error('Export window must be explicit UTC ISO timestamps spanning no more than 30 days');
        }
        const now = Date.now();
        if (end > now || start < now - 30 * DAY) throw new Error('Export must stay within the current 30-day research retention window');
        const maximum = Number(options['--max']);
        if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum >= 100_000) throw new Error('--max must be an integer from 1 to 99999');
         const events = await session.executeRead(tx => tx.run(
          `MATCH (event:ActivityEvent {schemaVersion: $version}) WHERE event.occurredAt >= datetime($from) AND event.occurredAt < datetime($to)
           MATCH (actor:User {id: event.actorId}) WHERE actor.deletedAt IS NULL
           OPTIONAL MATCH (target:User {id: event.targetUserId})
           WITH event, actor, target WHERE event.targetUserId IS NULL OR (target IS NOT NULL AND target.deletedAt IS NULL)
           RETURN ${EVENT_FIELDS} ORDER BY event.occurredAt, event.eventId LIMIT $limit`,
          { version: ACTIVITY_SCHEMA_VERSION, from, to, limit: neo4j.int(maximum + 1) },
        ));
        if (events.records.length > maximum) throw new Error('Export exceeded the explicit maximum; narrow the time window');
        const auth = await session.executeRead(tx => tx.run(
          `MATCH (event:AuthActivityEvent) WHERE event.source = 'APPLICATION' AND event.schemaVersion = 1
             AND event.eventType IN $types AND event.timestamp >= datetime($from) AND event.timestamp < datetime($to)
           MATCH (user:User {id: event.userId}) WHERE user.deletedAt IS NULL
           RETURN event.eventId AS eventId, event.schemaVersion AS schemaVersion, event.eventType AS eventType,
                  event.timestamp AS occurredAt, event.source AS source, event.userId AS actorId,
                  null AS targetUserId, null AS objectType, null AS objectId ORDER BY event.timestamp, event.eventId LIMIT $limit`,
          { types: [...AUTH_TYPES], from, to, limit: neo4j.int(maximum + 1) },
        ));
        if (auth.records.length > maximum || events.records.length + auth.records.length > maximum) {
          throw new Error('Export exceeded the explicit maximum; narrow the time window');
        }
        const keyFile = options['--key-file'];
        const secret = await readKey(keyFile);
        const bundle = createActivityBundle([...normalizeActivityRows(events), ...normalizeActivityRows(auth)], {
          from, to, sourceWatermark: to, secret, keyVersion: env.ACTIVITY_KEY_VERSION, mode: 'APPLICATION',
        });
        const file = await publishSnapshot(directory, bundle);
        console.log(JSON.stringify({ command, database: 'isn-test', databaseUuid, rows: bundle.rows.length, snapshot: file, label: options['--label'] ?? null }));
        return;
      }
      if (command === 'erase') {
        const userId = options['--user-id'];
        if (!userId) throw new Error('Erase requires --user-id');
        const account = await session.run('MATCH (user:User {id: $userId}) RETURN count(user) AS count', { userId });
        if (account.records[0].get('count').toNumber() !== 0) throw new Error('Erase requires the actor account to be absent');
        const key = await readKey(options['--key-file']);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(userId)) throw new Error('Erase requires a valid user UUID');
        const pseudonym = pseudonymizeUser(key, userId);
        const revoked = await revokeSnapshots(directory, pseudonym, { secret: key, keyVersion: env.ACTIVITY_KEY_VERSION });
        let removedEvents = 0;
        for (;;) {
          const removed = await session.run(
            `MATCH (event:ActivityEvent {schemaVersion: $version}) WHERE event.actorId = $userId OR event.targetUserId = $userId
             WITH event LIMIT $limit DELETE event RETURN count(*) AS removed`,
            { version: ACTIVITY_SCHEMA_VERSION, userId, limit: neo4j.int(MAX_BATCH) },
          );
          const count = removed.records[0].get('removed').toNumber();
          removedEvents += count;
          if (count < MAX_BATCH) break;
        }
        console.log(JSON.stringify({ command, database: 'isn-test', databaseUuid, revokedSnapshots: revoked.revoked, removedEvents }));
        return;
      }
      if (command === 'purge' || command === 'maintenance') {
        let deleted = 0;
        for (;;) {
          const result = await session.run(
            `MATCH (event:ActivityEvent {schemaVersion: $version}) WHERE event.occurredAt < datetime() - duration('P30D')
             WITH event LIMIT $limit DELETE event RETURN count(*) AS deleted`,
            { version: ACTIVITY_SCHEMA_VERSION, limit: neo4j.int(MAX_BATCH) },
          );
          const count = result.records[0].get('deleted').toNumber();
          deleted += count;
          if (count < MAX_BATCH) break;
        }
        const snapshots = await applyRetention(directory);
        console.log(JSON.stringify({ command, database: 'isn-test', databaseUuid, deletedEvents: deleted, ...snapshots }));
      }
      } finally { await lock.close(); await unlink(path.join(directory, '.lock')); }
    } finally { await session.close(); }
  } finally { await driver.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runOperator(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
