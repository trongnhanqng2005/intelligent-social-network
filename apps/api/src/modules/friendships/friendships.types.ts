import type { PublicProfile } from '../users/users.types.js';
import type { PublicRelationship } from './friendship-pair.js';

export type FriendshipRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface FriendshipRequest {
  id: string;
  senderId: string;
  recipientId: string;
  status: FriendshipRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface FriendshipRequestListItem {
  request: FriendshipRequest;
  member: PublicProfile;
}

export interface FriendshipListItem {
  friendshipId: string;
  friendsSince: string;
  member: PublicProfile;
}

export interface FriendshipPage<T> {
  items: T[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface FriendshipMutationResult {
  request: FriendshipRequest;
  relationship: PublicRelationship;
}

export type RepositoryMutationOutcome =
  | { kind: 'success'; result: FriendshipMutationResult }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict'; reason: 'same-pending' | 'incoming-pending' | 'already-friends' | 'state' | 'self' };

export type FriendshipRequestAction = 'accept' | 'reject' | 'cancel';
