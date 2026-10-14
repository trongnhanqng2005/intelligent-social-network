import { decodeFriendshipCursor, encodeFriendshipCursor } from './friendship-pagination.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const lastId = '22222222-2222-4222-8222-222222222222';

describe('friendship pagination cursors', () => {
  it('round-trips a cursor bound to the viewer, list and request direction', () => {
    const cursor = encodeFriendshipCursor({ scope: 'requests', viewerId, direction: 'received', lastId });
    expect(decodeFriendshipCursor(cursor, { scope: 'requests', viewerId, direction: 'received' })).toBe(lastId);
  });

  it('rejects malformed, noncanonical, oversized and cross-scope cursors', () => {
    const valid = encodeFriendshipCursor({ scope: 'friends', viewerId, lastId });
    for (const cursor of ['', 'not-base64', 'e30', 'a'.repeat(513)]) {
      expect(() => decodeFriendshipCursor(cursor, { scope: 'friends', viewerId })).toThrow();
    }
    expect(() => decodeFriendshipCursor(valid, {
      scope: 'requests', viewerId, direction: 'sent',
    })).toThrow();
    expect(() => decodeFriendshipCursor(valid, {
      scope: 'friends', viewerId: lastId,
    })).toThrow();
  });

  it('rejects unknown cursor fields and invalid IDs', () => {
    const cursor = Buffer.from(JSON.stringify({
      v: 1, scope: 'friends', viewerId, lastId: 'invalid', extra: true,
    })).toString('base64url');
    expect(() => decodeFriendshipCursor(cursor, { scope: 'friends', viewerId })).toThrow();
  });
});
