import type { ManagedTransaction } from 'neo4j-driver';
import { FriendshipsRepository } from './friendships.repository.js';
import { Neo4jService } from '../../neo4j/neo4j.service.js';

const senderId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const pairKey = `${senderId}:${recipientId}`;
const requestId = '33333333-3333-4333-8333-333333333333';

function record(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('FriendshipsRepository', () => {
  let neo4j: jest.Mocked<Neo4jService>;
  let transaction: jest.Mocked<ManagedTransaction>;
  let repository: FriendshipsRepository;

  beforeEach(() => {
    transaction = { run: jest.fn() } as unknown as jest.Mocked<ManagedTransaction>;
    neo4j = {
      executeRead: jest.fn(async (work) => work(transaction)),
      executeWrite: jest.fn(async (work) => work(transaction)),
    } as unknown as jest.Mocked<Neo4jService>;
    repository = new FriendshipsRepository(neo4j);
  });

  it('locks the canonical pair before checking state and creating a request', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [record({ count: 0 })] } as never)
      .mockResolvedValueOnce({ records: [record({
        requestId, senderId, recipientId, requestStatus: 'PENDING',
        createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      })] } as never);

    const result = await repository.createRequest({
      senderId, recipientId: recipientId.toUpperCase(), requestId, now: '2026-10-14T10:00:00.000Z',
    });
    expect(result).toMatchObject({
      kind: 'success', result: { request: { id: requestId, status: 'PENDING' }, relationship: { state: 'outgoing_pending' } },
    });
    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[0]).toContain('MERGE (pair:FriendshipPair');
    expect(queries[0]).toContain('SET pair.version = pair.version + 1');
    expect(queries[1]).toContain('MATCH (pair:FriendshipPair {pairKey: $pairKey})');
    expect(queries[1]).toContain('pair.requestId AS requestId');
    expect(queries[3]).toContain("pair.requestStatus = 'PENDING'");
    expect(neo4j.executeWrite).toHaveBeenCalledTimes(1);
  });

  it('treats a newly created pair control node with no lifecycle as available', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({ count: 0 })] } as never)
      .mockResolvedValueOnce({ records: [record({
        requestId, senderId, recipientId, requestStatus: 'PENDING',
        createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      })] } as never);

    await expect(repository.createRequest({ senderId, recipientId, requestId, now: '2026-10-14T10:00:00.000Z' }))
      .resolves.toMatchObject({ kind: 'success', result: { request: { id: requestId, status: 'PENDING' } } });
    expect(transaction.run).toHaveBeenCalledTimes(4);
  });

  it('fails closed when a pair has a partially initialized lifecycle', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId, requestId })] } as never);

    await expect(repository.createRequest({ senderId, recipientId, requestId, now: 'now' }))
      .rejects.toThrow('Friendship pair lifecycle is incomplete');
    expect(transaction.run).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate pending requests while holding the pair lock', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey, lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({
        pairKey, lowUserId: senderId, highUserId: recipientId, requestId,
        senderId, recipientId, requestStatus: 'PENDING', friendshipId: null,
        friendsSince: null, createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      })] } as never);

    await expect(repository.createRequest({ senderId, recipientId, requestId, now: 'now' }))
      .resolves.toEqual({ kind: 'conflict', reason: 'same-pending' });
    expect(transaction.run).toHaveBeenCalledTimes(2);
  });

  it('re-checks ownership after locking and hides request IDs from nonparticipants', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey })] } as never)
      .mockResolvedValueOnce({ records: [record({ lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({
        pairKey, lowUserId: senderId, highUserId: recipientId, requestId,
        senderId, recipientId, requestStatus: 'PENDING', friendshipId: null,
        friendsSince: null, createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      })] } as never);

    const result = await repository.actOnRequest({
      actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId, action: 'accept',
      friendshipId: '44444444-4444-4444-8444-444444444444', now: 'now',
    });
    expect(result).toEqual({ kind: 'not-found' });
    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[0]).toContain('MATCH (pair:FriendshipPair {requestId: $requestId})');
    expect(queries[1]).toContain('SET pair.version = pair.version + 1');
    expect(queries[2]).toContain('MATCH (pair:FriendshipPair {pairKey: $pairKey})');
    expect(queries).toHaveLength(3);
  });

  it('creates one canonical accepted edge and updates the pair in the same managed transaction', async () => {
    const friendshipId = '55555555-5555-4555-8555-555555555555';
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey })] } as never)
      .mockResolvedValueOnce({ records: [record({ lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({
        pairKey, lowUserId: senderId, highUserId: recipientId, requestId,
        senderId, recipientId, requestStatus: 'PENDING', friendshipId: null,
        friendsSince: null, createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      })] } as never)
      .mockResolvedValueOnce({ records: [record({ count: 0 })] } as never)
      .mockResolvedValueOnce({ records: [record({
        lowUserId: senderId, highUserId: recipientId,
        requestId, senderId, recipientId, requestStatus: 'ACCEPTED',
        createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: '2026-10-14T10:01:00.000Z',
        friendshipId, friendsSince: '2026-10-14T10:01:00.000Z',
      })] } as never);

    const result = await repository.actOnRequest({
      actorId: recipientId, requestId, action: 'accept', friendshipId, now: '2026-10-14T10:01:00.000Z',
    });
    expect(result).toMatchObject({
      kind: 'success',
      result: {
        request: { status: 'ACCEPTED' },
        relationship: { state: 'friends', friendshipId },
      },
    });
    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[4]).toContain('CREATE (low)-[friendship:FRIEND_WITH');
    expect(queries[4]).toContain('pair.lowUserId AS lowUserId');
    expect(queries[4]).toContain('pair.highUserId AS highUserId');
    expect(queries[4]).toContain("pair.requestStatus = 'ACCEPTED'");
    expect(neo4j.executeWrite).toHaveBeenCalledTimes(1);
  });

  it('makes stale or nonparticipant unfriends harmless', async () => {
    const friendshipId = '55555555-5555-4555-8555-555555555555';
    transaction.run
      .mockResolvedValueOnce({ records: [record({ pairKey })] } as never)
      .mockResolvedValueOnce({ records: [record({ lowUserId: senderId, highUserId: recipientId })] } as never)
      .mockResolvedValueOnce({ records: [record({ lowUserId: senderId, highUserId: recipientId })] } as never);

    await expect(repository.unfriend('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', friendshipId)).resolves.toBeUndefined();
    expect(transaction.run).toHaveBeenCalledTimes(3);
  });
});
