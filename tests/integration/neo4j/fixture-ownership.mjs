import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const recoveryDirectory = resolve('.artifacts/weylume/profile-acceptance-recovery');

export async function recordFixtureOwnership(email, userId) {
  assert.match(email, /^profile-[0-9a-f-]{36}@example\.invalid$/iu);
  if (userId !== undefined) assert.match(userId, /^[0-9a-f-]{36}$/iu);
  await mkdir(recoveryDirectory, { recursive: true });
  const path = resolve(recoveryDirectory, `profile-account-${process.pid}-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify({ version: 1, pid: process.pid, email, ...(userId ? { userId } : {}) }), { flag: 'wx' });
  return path;
}

export async function updateFixtureOwnership(path, email, userId) {
  assert.match(email, /^profile-[0-9a-f-]{36}@example\.invalid$/iu);
  assert.match(userId, /^[0-9a-f-]{36}$/iu);
  await writeFile(path, JSON.stringify({ version: 1, pid: process.pid, email, userId }));
}

export async function removeOwnedFixture(session, email, userId) {
  assert.match(email, /^profile-[0-9a-f-]{36}@example\.invalid$/iu);
  assert.match(userId, /^[0-9a-f-]{36}$/iu);

  const ownerResult = await session.run(
    'MATCH (user:User) WHERE user.id = $userId OR user.email = $email RETURN user.id AS id, user.email AS email',
    { userId, email },
  );
  if (ownerResult.records.length === 0) return { users: 0, sessions: 0, events: 0 };
  if (ownerResult.records.length !== 1 || ownerResult.records[0].get('id') !== userId ||
      ownerResult.records[0].get('email') !== email) {
    throw new Error('Fixture identity does not match its durable ownership manifest; no records were deleted.');
  }

  const relations = await session.run(
    `MATCH (user:User {id: $userId, email: $email}) OPTIONAL MATCH (user)-[relationship]-()
     RETURN collect(DISTINCT type(relationship)) AS types`, { userId, email },
  );
  const relationTypes = (relations.records[0]?.get('types') ?? []).filter(Boolean);
  if (relationTypes.some((type) => type !== 'HAS_AUTH_SESSION' && type !== 'PERFORMED_AUTH_EVENT')) {
    throw new Error('Fixture has an unexpected relationship; no records were deleted.');
  }

  const linked = await session.run(
    `MATCH (user:User {id: $userId, email: $email})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
     WITH user, collect(DISTINCT authSession) AS sessions
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN [item IN sessions WHERE item IS NOT NULL | item.id] AS sessionIds,
            collect(DISTINCT event.eventId) AS eventIds`, { userId, email },
  );
  const sessionIds = linked.records[0]?.get('sessionIds') ?? [];
  const eventIds = (linked.records[0]?.get('eventIds') ?? []).filter(Boolean);
  const shared = await session.run(
    `MATCH (other:User)-[relationship]->(item)
     WHERE other.id <> $userId AND
           ((type(relationship) = 'HAS_AUTH_SESSION' AND item:AuthSession AND item.id IN $sessionIds) OR
            (type(relationship) = 'PERFORMED_AUTH_EVENT' AND item:AuthActivityEvent AND item.eventId IN $eventIds))
     RETURN count(item) AS count`, { sessionIds, eventIds, userId },
  );
  if (asNumber(shared.records[0]?.get('count')) !== 0) {
    throw new Error('Fixture auth records are linked to another user; no records were deleted.');
  }

  await session.executeWrite((transaction) => transaction.run(
    `MATCH (user:User {id: $userId, email: $email})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     WITH user, collect(DISTINCT authSession) AS sessions, collect(DISTINCT event) AS events
     UNWIND [user] + [item IN sessions WHERE item IS NOT NULL] + [item IN events WHERE item IS NOT NULL] AS owned
     DETACH DELETE owned`, { userId, email },
  ));

  const remaining = await session.run(
    `MATCH (record)
     WHERE (record:User AND (record.id = $userId OR record.email = $email)) OR
           (record:AuthSession AND record.id IN $sessionIds) OR
           (record:AuthActivityEvent AND record.eventId IN $eventIds)
     RETURN count(record) AS count`, { userId, email, sessionIds, eventIds },
  );
  assert.equal(asNumber(remaining.records[0]?.get('count')), 0, 'Exact owned fixture records must be absent after cleanup');
  return { users: 1, sessions: sessionIds.length, events: eventIds.length };
}

export async function removeFixtureManifest(path) {
  await rm(path);
}

export function countAsNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}

function asNumber(value) {
  return countAsNumber(value);
}
