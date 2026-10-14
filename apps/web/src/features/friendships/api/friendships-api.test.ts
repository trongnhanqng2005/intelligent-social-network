import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actOnFriendshipRequest,
  createFriendshipRequest,
  FriendshipApiError,
  getFriendshipRelationship,
  listFriendshipRequests,
  listFriendships,
  unfriend,
} from './friendships-api';

const memberId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const friendshipId = '33333333-3333-4333-8333-333333333333';
const member = { id: memberId, displayName: 'Nguyễn An', bio: null, location: null };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('friendships API client', () => {
  it('sends authenticated, no-store JSON requests with a session CSRF token', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'signed-csrf' }))
      .mockResolvedValueOnce(jsonResponse({
        request: {
          id: requestId, senderId: memberId, recipientId: friendshipId,
          status: 'PENDING', createdAt: 'now', resolvedAt: null,
        },
        relationship: {
          memberId: friendshipId, state: 'outgoing_pending', requestId,
          friendshipId: null, friendsSince: null,
        },
      }, 201));
    vi.stubGlobal('fetch', fetch);

    await expect(createFriendshipRequest(friendshipId)).resolves.toMatchObject({
      request: { id: requestId, status: 'PENDING' },
      relationship: { state: 'outgoing_pending' },
    });
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/auth/csrf', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store',
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/friendships/requests', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'signed-csrf' }),
      body: JSON.stringify({ recipientId: friendshipId }),
    }));
  });

  it('encodes bounded list queries and validates privacy-safe list projections', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          request: { id: requestId, senderId: memberId, recipientId: friendshipId,
            status: 'PENDING', createdAt: 'now', resolvedAt: null },
          member,
        }],
        pagination: { limit: 20, hasMore: false, nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ friendshipId, friendsSince: 'now', member }],
        pagination: { limit: 20, hasMore: false, nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        relationship: { memberId, state: 'incoming_pending', requestId,
          friendshipId: null, friendsSince: null },
      }));
    vi.stubGlobal('fetch', fetch);

    await expect(listFriendshipRequests({ direction: 'received', cursor: 'opaque-cursor' }))
      .resolves.toMatchObject({ items: [{ member }], pagination: { hasMore: false } });
    await expect(listFriendships({ limit: 50 })).resolves.toMatchObject({ items: [{ friendshipId, member }] });
    await expect(getFriendshipRelationship(memberId)).resolves.toMatchObject({ state: 'incoming_pending', requestId });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/friendships/requests?direction=received&cursor=opaque-cursor');
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/friendships?limit=50');
  });

  it('posts request actions and issues a bodyless idempotent delete', async () => {
    const actionResponse = {
      request: { id: requestId, senderId: memberId, recipientId: friendshipId,
        status: 'ACCEPTED', createdAt: 'now', resolvedAt: 'then' },
      relationship: { memberId, state: 'friends', requestId: null, friendshipId, friendsSince: 'then' },
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(jsonResponse(actionResponse))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-2' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    await expect(actOnFriendshipRequest(requestId, 'accept')).resolves.toMatchObject({
      request: { status: 'ACCEPTED' }, relationship: { state: 'friends' },
    });
    await expect(unfriend(friendshipId)).resolves.toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toBe(`/api/friendships/requests/${requestId}/accept`);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(fetch.mock.calls[3]?.[0]).toBe(`/api/friendships/${friendshipId}`);
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(fetch.mock.calls[3]?.[1]).not.toHaveProperty('body');
  });

  it('preserves structured conflicts and rejects malformed server responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INCOMING_REQUEST_EXISTS', message: 'Đã nhận lời mời.' } }, 409));
    vi.stubGlobal('fetch', fetch);
    await expect(createFriendshipRequest(friendshipId)).rejects.toMatchObject({
      name: 'FriendshipApiError', status: 409, code: 'INCOMING_REQUEST_EXISTS',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      items: [{ request: {}, member: {} }],
      pagination: { limit: 20, hasMore: false, nextCursor: null },
    })));
    await expect(listFriendshipRequests({ direction: 'sent' })).rejects.toBeInstanceOf(FriendshipApiError);
  });
});
