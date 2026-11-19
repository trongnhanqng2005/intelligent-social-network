const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CanonicalFriendshipPair {
  lowUserId: string;
  highUserId: string;
  pairKey: string;
}

export interface FriendshipPairState {
  requestId: string;
  senderId: string;
  recipientId: string;
  requestStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  friendshipId: string | null;
  friendsSince: string | null;
}

export type RelationshipState = 'self' | 'none' | 'outgoing_pending' | 'incoming_pending' | 'friends';

export interface PublicRelationship {
  memberId: string;
  state: RelationshipState;
  requestId: string | null;
  friendshipId: string | null;
  friendsSince: string | null;
}

export function canonicalizeFriendshipPair(
  firstUserId: string,
  secondUserId: string,
): CanonicalFriendshipPair | null {
  if (!uuidPattern.test(firstUserId) || !uuidPattern.test(secondUserId)) {
    throw new TypeError('Friendship pair IDs must be UUIDs');
  }
  const first = firstUserId.toLowerCase();
  const second = secondUserId.toLowerCase();
  if (first === second) return null;
  const [lowUserId, highUserId] = first < second ? [first, second] : [second, first];
  return { lowUserId, highUserId, pairKey: `${lowUserId}:${highUserId}` };
}

export function relationshipState(
  viewerId: string,
  memberId: string,
  pair?: FriendshipPairState,
): PublicRelationship {
  const base = { memberId, requestId: null, friendshipId: null, friendsSince: null };
  if (viewerId.toLowerCase() === memberId.toLowerCase()) return { ...base, state: 'self' };
  if (!pair) return { ...base, state: 'none' };
  if (pair.requestStatus === 'PENDING') {
    return {
      ...base,
      state: pair.senderId === viewerId ? 'outgoing_pending' : 'incoming_pending',
      requestId: pair.requestId,
    };
  }
  if (pair.friendshipId) {
    return {
      ...base,
      state: 'friends',
      friendshipId: pair.friendshipId,
      friendsSince: pair.friendsSince,
    };
  }
  return { ...base, state: 'none' };
}
