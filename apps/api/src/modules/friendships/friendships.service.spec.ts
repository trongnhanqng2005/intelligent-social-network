import { HttpStatus } from '@nestjs/common';
import { FriendshipException } from './friendships.errors.js';
import { FriendshipsService } from './friendships.service.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const request = {
  id: '33333333-3333-4333-8333-333333333333',
  senderId: viewerId,
  recipientId: memberId,
  status: 'PENDING',
  createdAt: '2026-10-14T10:00:00.000Z',
  resolvedAt: null,
};

describe('FriendshipsService', () => {
  const repository = {
    createRequest: jest.fn(),
    actOnRequest: jest.fn(),
    listRequests: jest.fn(),
    listFriends: jest.fn(),
    getRelationship: jest.fn(),
    unfriend: jest.fn(),
  };
  let service: FriendshipsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FriendshipsService(repository as never);
    repository.createRequest.mockResolvedValue({
      kind: 'success',
      result: { request, relationship: { memberId, state: 'outgoing_pending', requestId: request.id, friendshipId: null, friendsSince: null } },
    });
    repository.actOnRequest.mockResolvedValue({
      kind: 'success',
      result: { request, relationship: { memberId, state: 'outgoing_pending', requestId: request.id, friendshipId: null, friendsSince: null } },
    });
    repository.listRequests.mockResolvedValue([]);
    repository.listFriends.mockResolvedValue([]);
    repository.getRelationship.mockResolvedValue({ kind: 'found', relationship: { memberId, state: 'none', requestId: null, friendshipId: null, friendsSince: null } });
    repository.unfriend.mockResolvedValue(undefined);
  });

  it('uses only the supplied authenticated actor ID and maps target absence', async () => {
    await expect(service.createRequest(viewerId, memberId, request.id, request.createdAt))
      .resolves.toEqual({ request, relationship: expect.objectContaining({ state: 'outgoing_pending' }) });
    expect(repository.createRequest).toHaveBeenCalledWith({
      senderId: viewerId, recipientId: memberId, requestId: request.id, now: request.createdAt,
    });
    repository.createRequest.mockResolvedValueOnce({ kind: 'not-found' });
    await expect(service.createRequest(viewerId, memberId, request.id, request.createdAt))
      .rejects.toMatchObject({ status: HttpStatus.NOT_FOUND, response: { error: { code: 'MEMBER_NOT_FOUND' } } });
  });

  it.each([
    ['same-pending', 'REQUEST_ALREADY_PENDING'],
    ['incoming-pending', 'INCOMING_REQUEST_EXISTS'],
    ['already-friends', 'ALREADY_FRIENDS'],
    ['self', 'SELF_FRIENDSHIP'],
    ['state', 'FRIENDSHIP_STATE_CONFLICT'],
  ] as const)('maps request conflict %s to %s', async (reason, code) => {
    repository.createRequest.mockResolvedValueOnce({ kind: 'conflict', reason });
    await expect(service.createRequest(viewerId, memberId, request.id, request.createdAt))
      .rejects.toMatchObject({ status: HttpStatus.CONFLICT, response: { error: { code } } });
  });

  it('applies bounded cursor pagination and binds request cursors to viewer and direction', async () => {
    repository.listRequests.mockResolvedValueOnce([
      { request, member: { id: memberId, displayName: 'An', bio: null, location: null } },
      { request: { ...request, id: '44444444-4444-4444-8444-444444444444' }, member: { id: memberId, displayName: 'An', bio: null, location: null } },
    ]);
    const firstPage = await service.listRequests(viewerId, { direction: 'received', limit: 1 });
    expect(repository.listRequests).toHaveBeenCalledWith({
      viewerId, direction: 'received', fetchLimit: 2,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.pagination).toMatchObject({ limit: 1, hasMore: true });
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String));

    await expect(service.listRequests(memberId, {
      direction: 'sent', cursor: firstPage.pagination.nextCursor!,
    })).rejects.toBeInstanceOf(FriendshipException);
    await expect(service.listFriends(viewerId, { limit: 0 }))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    await expect(service.listRequests(viewerId, { direction: 'received', cursor: 'not-a-cursor' }))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });

  it('maps nonparticipant and wrong-role request actions without leaking requests', async () => {
    repository.actOnRequest.mockResolvedValueOnce({ kind: 'not-found' });
    await expect(service.actOnRequest(viewerId, request.id, 'accept', '55555555-5555-4555-8555-555555555555', request.createdAt))
      .rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    repository.actOnRequest.mockResolvedValueOnce({ kind: 'forbidden' });
    await expect(service.actOnRequest(viewerId, request.id, 'accept', '55555555-5555-4555-8555-555555555555', request.createdAt))
      .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('returns member-not-found for missing relationship targets and keeps unfriend idempotent', async () => {
    repository.getRelationship.mockResolvedValueOnce({ kind: 'not-found' });
    await expect(service.getRelationship(viewerId, memberId)).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    await expect(service.unfriend(viewerId, request.id)).resolves.toBeUndefined();
    expect(repository.unfriend).toHaveBeenCalledWith(viewerId, request.id);
  });

  it('enforces process-local per-user read and mutation limits with a retry delay', async () => {
    for (let index = 0; index < 20; index += 1) {
      await service.createRequest(viewerId, memberId, request.id, request.createdAt);
    }
    await expect(service.createRequest(viewerId, memberId, request.id, request.createdAt))
      .rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        retryAfterSeconds: expect.any(Number),
        response: { error: { code: 'RATE_LIMITED' } },
      });
    expect(repository.createRequest).toHaveBeenCalledTimes(20);

    for (let index = 0; index < 120; index += 1) {
      await service.getRelationship(viewerId, memberId);
    }
    await expect(service.getRelationship(viewerId, memberId)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { error: { code: 'RATE_LIMITED' } },
    });
    expect(repository.getRelationship).toHaveBeenCalledTimes(120);
  });
});
