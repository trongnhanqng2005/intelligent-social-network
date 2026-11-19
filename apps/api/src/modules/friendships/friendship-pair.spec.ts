import { canonicalizeFriendshipPair, relationshipState } from './friendship-pair.js';

const low = '11111111-1111-4111-8111-111111111111';
const high = '22222222-2222-4222-8222-222222222222';

describe('friendship pair domain', () => {
  it('uses one stable pair key regardless of caller direction or UUID casing', () => {
    expect(canonicalizeFriendshipPair(high.toUpperCase(), low)).toEqual({
      lowUserId: low,
      highUserId: high,
      pairKey: `${low}:${high}`,
    });
    expect(canonicalizeFriendshipPair(low, high)).toEqual({
      lowUserId: low,
      highUserId: high,
      pairKey: `${low}:${high}`,
    });
  });

  it('rejects invalid member IDs and identifies self-friendship', () => {
    expect(() => canonicalizeFriendshipPair('not-a-uuid', high)).toThrow();
    expect(canonicalizeFriendshipPair(low.toUpperCase(), low)).toBeNull();
  });

  it('derives only the caller-relative public relationship state', () => {
    expect(relationshipState(low, low)).toMatchObject({ state: 'self' });
    expect(relationshipState(low, high)).toMatchObject({ state: 'none' });
    expect(relationshipState(low, high, {
      requestId: 'request-id', senderId: low, recipientId: high,
      requestStatus: 'PENDING', friendshipId: null, friendsSince: null,
    })).toMatchObject({ state: 'outgoing_pending', requestId: 'request-id' });
    expect(relationshipState(high, low, {
      requestId: 'request-id', senderId: low, recipientId: high,
      requestStatus: 'PENDING', friendshipId: null, friendsSince: null,
    })).toMatchObject({ state: 'incoming_pending', requestId: 'request-id' });
    expect(relationshipState(low, high, {
      requestId: 'request-id', senderId: low, recipientId: high,
      requestStatus: 'ACCEPTED', friendshipId: 'friendship-id', friendsSince: 'now',
    })).toMatchObject({ state: 'friends', friendshipId: 'friendship-id', friendsSince: 'now' });
  });

  it('does not expose the last accepted lifecycle as a current friendship after unfriend', () => {
    expect(relationshipState(low, high, {
      requestId: 'old-request', senderId: low, recipientId: high,
      requestStatus: 'ACCEPTED', friendshipId: null, friendsSince: null,
    })).toMatchObject({ state: 'none', requestId: null, friendshipId: null });
  });
});
