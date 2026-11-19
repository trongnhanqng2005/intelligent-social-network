const assert = require('node:assert/strict');
const test = require('node:test');
const { captureBaseline } = require('../fixtures/friendships/acceptance-support.cjs');

function baselineSession({ email = 'private@example.invalid', passwordHash = 'secret-password-hash', jti = 'secret-session-jti' } = {}) {
  const rows = [
    {
      id: '11111111-1111-4111-8111-111111111111', email, passwordHash,
      createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z',
      displayName: 'Private Member', displayNameSearch: 'private member', bio: null, location: null,
      profileCreatedAt: '2026-10-14T10:00:00.000Z', profileUpdatedAt: '2026-10-14T10:00:00.000Z', profileVersion: 0,
    },
    { id: '22222222-2222-4222-8222-222222222222', jti, createdAt: 'created', expiresAt: 'expires', revokedAt: null, userIds: [] },
    { id: '33333333-3333-4333-8333-333333333333', userId: 'user', sessionId: 'session', eventType: 'AUTH_LOGIN_SUCCEEDED', schemaVersion: 1, timestamp: 'event-time', source: 'APPLICATION', userIds: [] },
    { pairKey: 'low:high', lowUserId: 'low', highUserId: 'high', version: 1, requestId: 'request', senderId: 'low', recipientId: 'high', requestStatus: 'CANCELLED', requestedAt: 'request-time', resolvedAt: 'resolved-time', friendshipId: null, friendsSince: null },
    { lowUserId: 'low', highUserId: 'high', id: 'edge', pairKey: 'low:high', since: 'since' },
  ];
  const queryRows = new Map([
    ['MATCH (u:User)', [rows[0]]],
    ['MATCH (s:AuthSession)', [rows[1]]],
    ['MATCH (e:AuthActivityEvent)', [rows[2]]],
    ['MATCH (p:FriendshipPair)', [rows[3]]],
    ['MATCH (low:User)-[e:FRIEND_WITH]->(high:User)', [rows[4]]],
    ['MATCH (migration:ISNSchemaMigration)', [{ version: 4, name: 'friendship-system', checksum: 'checksum', status: 'VERIFIED', appliedAt: 'applied', verifiedAt: 'verified' }]],
    ["MATCH (marker:ISNSchema {key:'application'})", [{ version: 4 }]],
  ]);
  return {
    async run(query) {
      const match = [...queryRows].find(([needle]) => query.includes(needle));
      assert.ok(match, `Unexpected baseline query: ${query}`);
      return {
        records: match[1].map((values) => ({
          keys: Object.keys(values),
          get(key) { return values[key]; },
        })),
      };
    },
  };
}

test('preservation manifest baseline contains fingerprints and counts, not raw auth/profile records', async () => {
  const baseline = await captureBaseline(baselineSession());
  const serialized = JSON.stringify(baseline);

  assert.deepEqual(Object.keys(baseline).sort(), ['catalogFingerprint', 'counts', 'fingerprint', 'migrationVersions']);
  assert.equal(baseline.counts.users, 1);
  assert.equal(baseline.counts.sessions, 1);
  assert.equal(baseline.counts.authEvents, 1);
  for (const sensitiveValue of ['private@example.invalid', 'secret-password-hash', 'secret-session-jti']) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }

  const changedBaseline = await captureBaseline(baselineSession({ passwordHash: 'different-password-hash' }));
  assert.notEqual(changedBaseline.fingerprint, baseline.fingerprint,
    'The full preservation fingerprint must still detect changes to protected user records.');
});
