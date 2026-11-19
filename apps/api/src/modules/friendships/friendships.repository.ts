import { Injectable } from '@nestjs/common';
import { int, type ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import { canonicalizeFriendshipPair, relationshipState } from './friendship-pair.js';
import type { FriendshipPairState } from './friendship-pair.js';
import type {
  FriendshipListItem,
  FriendshipMutationResult,
  FriendshipPage,
  FriendshipRequest,
  FriendshipRequestAction,
  FriendshipRequestListItem,
  RepositoryMutationOutcome,
} from './friendships.types.js';
import type { FriendshipRequestDirection } from './friendship-pagination.js';

interface PairRecord extends FriendshipPairState {
  pairKey: string;
  lowUserId: string;
  highUserId: string;
  createdAt: string;
  resolvedAt: string | null;
}

@Injectable()
export class FriendshipsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async createRequest(input: {
    senderId: string;
    recipientId: string;
    requestId: string;
    now: string;
  }): Promise<RepositoryMutationOutcome> {
    const canonical = canonicalizeFriendshipPair(input.senderId, input.recipientId);
    if (!canonical) return { kind: 'conflict', reason: 'self' };

    return this.neo4j.executeWrite(async (transaction) => {
      const locked = await transaction.run(
        `MATCH (sender:User {id: $senderId}), (recipient:User {id: $recipientId})
         MERGE (pair:FriendshipPair {pairKey: $pairKey})
         ON CREATE SET pair.lowUserId = $lowUserId, pair.highUserId = $highUserId,
                       pair.version = 0
         SET pair.version = pair.version + 1
         RETURN pair.pairKey AS pairKey, pair.lowUserId AS lowUserId, pair.highUserId AS highUserId`,
        { ...input, ...canonical },
      );
      if (!locked.records[0]) return { kind: 'not-found' };
      assertCanonicalRecord(locked.records[0], canonical);

      const current = await readPair(transaction, canonical.pairKey);
      if (current?.requestStatus === 'PENDING') {
        return {
          kind: 'conflict',
          reason: current.senderId === input.senderId ? 'same-pending' : 'incoming-pending',
        };
      }
      if (current?.friendshipId) return { kind: 'conflict', reason: 'already-friends' };
      await assertNoAcceptedEdge(transaction, canonical.pairKey);

      const result = await transaction.run(
        `MATCH (sender:User {id: $senderId}), (recipient:User {id: $recipientId})
         MATCH (pair:FriendshipPair {pairKey: $pairKey})
         SET pair.requestId = $requestId, pair.senderId = $senderId,
             pair.recipientId = $recipientId, pair.requestStatus = 'PENDING',
             pair.requestedAt = datetime($now), pair.resolvedAt = null,
             pair.friendshipId = null, pair.friendsSince = null
         RETURN pair.requestId AS requestId, pair.senderId AS senderId,
                pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
                toString(pair.requestedAt) AS createdAt,
                toString(pair.resolvedAt) AS resolvedAt`,
        { ...input, pairKey: canonical.pairKey },
      );
      const record = result.records[0];
      if (!record) return { kind: 'not-found' };
      const request = readRequest(record);
      return {
        kind: 'success',
        result: {
          request,
          relationship: relationshipState(input.senderId, input.recipientId, {
            requestId: request.id,
            senderId: request.senderId,
            recipientId: request.recipientId,
            requestStatus: 'PENDING',
            friendshipId: null,
            friendsSince: null,
          }),
        },
      };
    });
  }

  async actOnRequest(input: {
    actorId: string;
    requestId: string;
    action: FriendshipRequestAction;
    friendshipId: string;
    now: string;
  }): Promise<RepositoryMutationOutcome> {
    return this.neo4j.executeWrite(async (transaction) => {
      const located = await transaction.run(
        'MATCH (pair:FriendshipPair {requestId: $requestId}) RETURN pair.pairKey AS pairKey',
        { requestId: input.requestId },
      );
      const pairKey = nullableString(located.records[0]?.get('pairKey'));
      if (!pairKey) return { kind: 'not-found' };

      const locked = await transaction.run(
        `MATCH (pair:FriendshipPair {pairKey: $pairKey})
         SET pair.version = pair.version + 1
         RETURN pair.lowUserId AS lowUserId, pair.highUserId AS highUserId`,
        { pairKey },
      );
      if (!locked.records[0]) return { kind: 'not-found' };
      const current = await readPair(transaction, pairKey);
      if (!current || current.requestId !== input.requestId) return { kind: 'not-found' };

      const isRecipient = current.recipientId === input.actorId;
      const isSender = current.senderId === input.actorId;
      if (!isRecipient && !isSender) return { kind: 'not-found' };
      if ((input.action === 'cancel' && !isSender) ||
          (input.action !== 'cancel' && !isRecipient)) {
        return { kind: 'forbidden' };
      }

      const alreadyCompleted =
        (input.action === 'accept' && current.requestStatus === 'ACCEPTED') ||
        (input.action === 'reject' && current.requestStatus === 'REJECTED') ||
        (input.action === 'cancel' && current.requestStatus === 'CANCELLED');
      if (alreadyCompleted) return { kind: 'success', result: mutationResult(input.actorId, current) };
      if (current.requestStatus !== 'PENDING') return { kind: 'conflict', reason: 'state' };

      if (input.action === 'accept') {
        await assertNoAcceptedEdge(transaction, pairKey);
        const accepted = await transaction.run(
          `MATCH (pair:FriendshipPair {pairKey: $pairKey})
          MATCH (low:User), (high:User)
          WHERE low.id = pair.lowUserId AND high.id = pair.highUserId
          CREATE (low)-[friendship:FRIEND_WITH {
            id: $friendshipId, pairKey: $pairKey, since: datetime($now)
          }]->(high)
           SET pair.requestStatus = 'ACCEPTED', pair.resolvedAt = datetime($now),
               pair.friendshipId = $friendshipId, pair.friendsSince = datetime($now)
           RETURN pair.lowUserId AS lowUserId, pair.highUserId AS highUserId,
                  pair.requestId AS requestId, pair.senderId AS senderId,
                  pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
                 toString(pair.requestedAt) AS createdAt,
                 toString(pair.resolvedAt) AS resolvedAt,
                 pair.friendshipId AS friendshipId, toString(pair.friendsSince) AS friendsSince`,
          { pairKey, friendshipId: input.friendshipId, now: input.now },
        );
        const record = accepted.records[0];
        if (!record) return { kind: 'conflict', reason: 'state' };
        const pair = readPairRecord(record, pairKey);
        return { kind: 'success', result: mutationResult(input.actorId, pair) };
      }

      const terminalStatus = input.action === 'reject' ? 'REJECTED' : 'CANCELLED';
      const resolved = await transaction.run(
        `MATCH (pair:FriendshipPair {pairKey: $pairKey})
         SET pair.requestStatus = $requestStatus, pair.resolvedAt = datetime($now),
             pair.friendshipId = null, pair.friendsSince = null
         RETURN pair.requestId AS requestId, pair.senderId AS senderId,
                pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
                toString(pair.requestedAt) AS createdAt,
                toString(pair.resolvedAt) AS resolvedAt`,
        { pairKey, requestStatus: terminalStatus, now: input.now },
      );
      const record = resolved.records[0];
      if (!record) return { kind: 'not-found' };
      const request = readRequest(record);
      return {
        kind: 'success',
        result: {
          request,
          relationship: relationshipState(input.actorId,
            input.actorId === request.senderId ? request.recipientId : request.senderId, {
              requestId: request.id,
              senderId: request.senderId,
              recipientId: request.recipientId,
              requestStatus: terminalStatus,
              friendshipId: null,
              friendsSince: null,
            }),
        },
      };
    });
  }

  async listRequests(input: {
    viewerId: string;
    direction: FriendshipRequestDirection;
    afterId?: string;
    fetchLimit: number;
  }): Promise<FriendshipRequestListItem[]> {
    const ownerPredicate = input.direction === 'received'
      ? 'pair.recipientId = $viewerId'
      : 'pair.senderId = $viewerId';
    const memberPredicate = input.direction === 'received'
      ? 'member.id = pair.senderId'
      : 'member.id = pair.recipientId';
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (pair:FriendshipPair)
         WHERE pair.requestStatus = 'PENDING' AND ${ownerPredicate} AND
               ($afterId IS NULL OR pair.requestId > $afterId)
         MATCH (member:User)
         WHERE ${memberPredicate}
         RETURN pair.requestId AS requestId, pair.senderId AS senderId,
                pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
                toString(pair.requestedAt) AS createdAt,
                toString(pair.resolvedAt) AS resolvedAt,
                member.id AS memberId, member.displayName AS displayName,
                member.bio AS bio, member.location AS location
         ORDER BY pair.requestId ASC LIMIT $fetchLimit`,
        {
          viewerId: input.viewerId,
          afterId: input.afterId ?? null,
          fetchLimit: int(input.fetchLimit),
        },
      );
      return result.records.map((record) => ({
        request: readRequest(record),
        member: readMember(record),
      }));
    });
  }

  async listFriends(input: {
    viewerId: string;
    afterId?: string;
    fetchLimit: number;
  }): Promise<FriendshipListItem[]> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (viewer:User {id: $viewerId})-[friendship:FRIEND_WITH]-(member:User)
         MATCH (pair:FriendshipPair {pairKey: friendship.pairKey, friendshipId: friendship.id})
         WHERE member.id > $afterId OR $afterId IS NULL
         RETURN friendship.id AS friendshipId, toString(friendship.since) AS friendsSince,
                member.id AS memberId, member.displayName AS displayName,
                member.bio AS bio, member.location AS location
         ORDER BY member.id ASC LIMIT $fetchLimit`,
        {
          viewerId: input.viewerId,
          afterId: input.afterId ?? null,
          fetchLimit: int(input.fetchLimit),
        },
      );
      return result.records.map((record) => ({
        friendshipId: String(record.get('friendshipId')),
        friendsSince: String(record.get('friendsSince')),
        member: readMember(record),
      }));
    });
  }

  async getRelationship(viewerId: string, memberId: string) {
    if (viewerId === memberId) return { kind: 'found' as const, relationship: relationshipState(viewerId, memberId) };
    const canonical = canonicalizeFriendshipPair(viewerId, memberId);
    if (!canonical) return { kind: 'found' as const, relationship: relationshipState(viewerId, memberId) };
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (member:User {id: $memberId})
         OPTIONAL MATCH (pair:FriendshipPair {pairKey: $pairKey})
         OPTIONAL MATCH (low:User)-[friendship:FRIEND_WITH {pairKey: $pairKey}]->(high:User)
         WHERE pair.friendshipId IS NOT NULL AND friendship.id = pair.friendshipId AND
               low.id = pair.lowUserId AND high.id = pair.highUserId
         RETURN member.id AS memberId,
                pair.requestId AS requestId, pair.senderId AS senderId,
                pair.recipientId AS recipientId, pair.requestStatus AS requestStatus,
                CASE WHEN friendship IS NULL THEN null ELSE pair.friendshipId END AS friendshipId,
                CASE WHEN friendship IS NULL THEN null ELSE toString(pair.friendsSince) END AS friendsSince`,
        { memberId, pairKey: canonical.pairKey },
      );
      const record = result.records[0];
      if (!record) return { kind: 'not-found' as const };
      const pair = readOptionalPair(record);
      return { kind: 'found' as const, relationship: relationshipState(viewerId, memberId, pair) };
    });
  }

  async unfriend(actorId: string, friendshipId: string): Promise<void> {
    await this.neo4j.executeWrite(async (transaction) => {
      const located = await transaction.run(
        `MATCH (:User)-[friendship:FRIEND_WITH {id: $friendshipId}]->(:User)
         RETURN friendship.pairKey AS pairKey`,
        { friendshipId },
      );
      const pairKey = nullableString(located.records[0]?.get('pairKey'));
      if (!pairKey) return;

      const locked = await transaction.run(
        `MATCH (pair:FriendshipPair {pairKey: $pairKey})
         SET pair.version = pair.version + 1
         RETURN pair.lowUserId AS lowUserId, pair.highUserId AS highUserId`,
        { pairKey },
      );
      if (!locked.records[0]) throw new Error('Friendship edge has no pair control node');
      const lowUserId = String(locked.records[0].get('lowUserId'));
      const highUserId = String(locked.records[0].get('highUserId'));
      const locatedEdge = await transaction.run(
        `MATCH (low:User {id: $lowUserId})-[friendship:FRIEND_WITH {
           id: $friendshipId, pairKey: $pairKey
         }]->(high:User {id: $highUserId})
         RETURN low.id AS lowUserId, high.id AS highUserId`,
        { lowUserId, highUserId, pairKey, friendshipId },
      );
      if (!locatedEdge.records[0]) return;
      if (actorId !== lowUserId && actorId !== highUserId) return;
      await transaction.run(
        `MATCH (pair:FriendshipPair {pairKey: $pairKey})
         MATCH (low:User {id: $lowUserId})-[friendship:FRIEND_WITH {
           id: $friendshipId, pairKey: $pairKey
         }]->(high:User {id: $highUserId})
         DELETE friendship
         SET pair.friendshipId = null, pair.friendsSince = null`,
        { lowUserId, highUserId, pairKey, friendshipId },
      );
    });
  }
}

async function readPair(
  transaction: ManagedTransaction,
  pairKey: string,
): Promise<PairRecord | undefined> {
  const result = await transaction.run(
    `MATCH (pair:FriendshipPair {pairKey: $pairKey})
     RETURN pair.pairKey AS pairKey, pair.lowUserId AS lowUserId,
            pair.highUserId AS highUserId, pair.requestId AS requestId,
            pair.senderId AS senderId, pair.recipientId AS recipientId,
            pair.requestStatus AS requestStatus, pair.friendshipId AS friendshipId,
            toString(pair.friendsSince) AS friendsSince,
            toString(pair.requestedAt) AS createdAt, toString(pair.resolvedAt) AS resolvedAt`,
    { pairKey },
  );
  const record = result.records[0];
  if (!record) return undefined;
  const lifecycleFields = [
    'requestId', 'senderId', 'recipientId', 'requestStatus', 'friendshipId',
    'friendsSince', 'createdAt', 'resolvedAt',
  ];
  if (lifecycleFields.every((field) => record.get(field) === null || record.get(field) === undefined)) {
    return undefined;
  }
  return readPairRecord(record, pairKey);
}

async function assertNoAcceptedEdge(transaction: ManagedTransaction, pairKey: string): Promise<void> {
  const result = await transaction.run(
    'MATCH ()-[friendship:FRIEND_WITH {pairKey: $pairKey}]-() RETURN count(friendship) AS count',
    { pairKey },
  );
  if (asNumber(result.records[0]?.get('count')) !== 0) {
    throw new Error('Friendship pair has an unexpected accepted relationship');
  }
}

function mutationResult(actorId: string, pair: PairRecord): FriendshipMutationResult {
  const request = pairRequest(pair);
  const memberId = actorId === pair.senderId ? pair.recipientId : pair.senderId;
  return {
    request,
    relationship: relationshipState(actorId, memberId, pair),
  };
}

function pairRequest(pair: PairRecord): FriendshipRequest {
  return {
    id: pair.requestId,
    senderId: pair.senderId,
    recipientId: pair.recipientId,
    status: pair.requestStatus,
    createdAt: pair.createdAt,
    resolvedAt: pair.resolvedAt,
  };
}

function readPairRecord(record: { get(key: string): unknown }, pairKey: string): PairRecord {
  const requestStatus = String(record.get('requestStatus')) as PairRecord['requestStatus'];
  const requestId = nullableString(record.get('requestId'));
  const senderId = nullableString(record.get('senderId'));
  const recipientId = nullableString(record.get('recipientId'));
  if (!requestId || !senderId || !recipientId) throw new Error('Friendship pair lifecycle is incomplete');
  return {
    pairKey,
    lowUserId: String(record.get('lowUserId') ?? ''),
    highUserId: String(record.get('highUserId') ?? ''),
    requestId,
    senderId,
    recipientId,
    requestStatus,
    friendshipId: nullableString(record.get('friendshipId')),
    friendsSince: nullableString(record.get('friendsSince')),
    createdAt: nullableString(record.get('createdAt')) ?? '',
    resolvedAt: nullableString(record.get('resolvedAt')),
  };
}

function readOptionalPair(record: { get(key: string): unknown }): FriendshipPairState | undefined {
  const requestId = nullableString(record.get('requestId'));
  const senderId = nullableString(record.get('senderId'));
  const recipientId = nullableString(record.get('recipientId'));
  const requestStatus = nullableString(record.get('requestStatus'));
  if (!requestId || !senderId || !recipientId || !requestStatus) return undefined;
  return {
    requestId,
    senderId,
    recipientId,
    requestStatus: requestStatus as FriendshipPairState['requestStatus'],
    friendshipId: nullableString(record.get('friendshipId')),
    friendsSince: nullableString(record.get('friendsSince')),
  };
}

function readRequest(record: { get(key: string): unknown }): FriendshipRequest {
  const requestId = nullableString(record.get('requestId'));
  const senderId = nullableString(record.get('senderId'));
  const recipientId = nullableString(record.get('recipientId'));
  if (!requestId || !senderId || !recipientId) throw new Error('Friendship request projection is incomplete');
  return {
    id: requestId,
    senderId,
    recipientId,
    status: String(record.get('requestStatus')) as FriendshipRequest['status'],
    createdAt: nullableString(record.get('createdAt')) ?? '',
    resolvedAt: nullableString(record.get('resolvedAt')),
  };
}

function readMember(record: { get(key: string): unknown }) {
  return {
    id: String(record.get('memberId')),
    displayName: String(record.get('displayName')),
    bio: nullableString(record.get('bio')),
    location: nullableString(record.get('location')),
  };
}

function assertCanonicalRecord(
  record: { get(key: string): unknown },
  canonical: { pairKey: string; lowUserId: string; highUserId: string },
): void {
  if (record.get('pairKey') !== canonical.pairKey ||
      record.get('lowUserId') !== canonical.lowUserId ||
      record.get('highUserId') !== canonical.highUserId) {
    throw new Error('Friendship pair canonical identity is inconsistent');
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number.NaN;
}
