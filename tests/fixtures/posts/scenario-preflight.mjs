import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const expectedV5Constraints = [
  ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['ISNSchema'], ['key']],
  ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['ISNSchemaMigration'], ['version']],
  ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['User'], ['id']],
  ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['User'], ['email']],
  ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthSession'], ['id']],
  ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthSession'], ['jti']],
  ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthActivityEvent'], ['eventId']],
  ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['FriendshipPair'], ['pairKey']],
  ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['FriendshipPair'], ['requestId']],
  ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', ['FRIEND_WITH'], ['id']],
  ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', ['FRIEND_WITH'], ['pairKey']],
  ['isn_post_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['Post'], ['id']],
];

export const expectedV5Indexes = [
  ['isn_auth_event_id', 'RANGE', 'NODE', ['AuthActivityEvent'], ['eventId']],
  ['isn_auth_session_id', 'RANGE', 'NODE', ['AuthSession'], ['id']],
  ['isn_auth_session_jti', 'RANGE', 'NODE', ['AuthSession'], ['jti']],
  ['isn_auth_session_expires_at', 'RANGE', 'NODE', ['AuthSession'], ['expiresAt']],
  ['isn_auth_event_timestamp', 'RANGE', 'NODE', ['AuthActivityEvent'], ['timestamp']],
  ['isn_schema_metadata_key', 'RANGE', 'NODE', ['ISNSchema'], ['key']],
  ['isn_schema_migration_version', 'RANGE', 'NODE', ['ISNSchemaMigration'], ['version']],
  ['isn_user_email', 'RANGE', 'NODE', ['User'], ['email']],
  ['isn_user_id', 'RANGE', 'NODE', ['User'], ['id']],
  ['isn_user_display_name_search', 'TEXT', 'NODE', ['User'], ['displayNameSearch']],
  ['isn_friendship_pair_key', 'RANGE', 'NODE', ['FriendshipPair'], ['pairKey']],
  ['isn_friendship_request_id', 'RANGE', 'NODE', ['FriendshipPair'], ['requestId']],
  ['isn_friendship_id', 'RANGE', 'RELATIONSHIP', ['FRIEND_WITH'], ['id']],
  ['isn_friendship_edge_pair_key', 'RANGE', 'RELATIONSHIP', ['FRIEND_WITH'], ['pairKey']],
  ['isn_friendship_requests_sent', 'RANGE', 'NODE', ['FriendshipPair'], ['senderId', 'requestStatus', 'requestId']],
  ['isn_friendship_requests_received', 'RANGE', 'NODE', ['FriendshipPair'], ['recipientId', 'requestStatus', 'requestId']],
  ['isn_post_author_chronology', 'RANGE', 'NODE', ['Post'], ['authorId', 'createdAt', 'id']],
  ['isn_post_id', 'RANGE', 'NODE', ['Post'], ['id']],
];

export function assertV5Catalog(constraints, indexes) {
  assert.deepEqual(constraints.map((row) => [row.name, row.type, row.entityType, row.labelsOrTypes, row.properties]).sort(byName),
    [...expectedV5Constraints].sort(byName));
  assert.deepEqual(indexes.map((row) => [row.name, row.type, row.entityType, row.labelsOrTypes, row.properties, row.state]).sort(byName),
    expectedV5Indexes.map(([name, type, entityType, labels, properties]) => [name, type, entityType, labels, properties, 'ONLINE']).sort(byName));
  return true;
}

export function assertV5History(status, definitions, checksumMigration) {
  assert.equal(status.status, 'current');
  assert.equal(status.database, 'isn-test');
  assert.equal(status.version, 5);
  assert.deepEqual(status.migrations.map(({ version, name, checksum, status: state, appliedAt, verifiedAt }) =>
    [version, name, checksum, state, Boolean(appliedAt), Boolean(verifiedAt)]),
  definitions.map((migration) => [migration.version, migration.name, checksumMigration(migration), 'VERIFIED', true, true]));
  return true;
}

export async function runPostsPreflightQueries(session, queries) {
  const results = [];
  for (const query of queries) results.push(await session.run(query));
  return results;
}

export function assertExactRestrictedPrivileges({ role, publicRole, effective }, approved) {
  assert.equal(new Set(approved).size, approved.length);
  const post = approved.filter((command) => /\bNODE Post\b|\bRELATIONSHIP AUTHORED\b/u.test(command));
  assert.equal(post.length, 14);
  assert.deepEqual([...role].sort(), [...approved].sort());
  assert.equal(publicRole.some((command) => /\b(?:GRANT|DENY)\b.*(?:`isn-test`|`isn-dev`|GRAPH \*)/iu.test(command)), false);
  const expectedEffective = [...role, ...publicRole]
    .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'))
    .sort();
  assert.deepEqual([...effective].sort(), expectedEffective);
  return true;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function byName(left, right) {
  return String(left[0]).localeCompare(String(right[0]));
}
