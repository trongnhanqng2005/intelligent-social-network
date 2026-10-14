import { resolveApiUrl } from '../../../shared/config/env';

export interface FriendshipMember {
  id: string;
  displayName: string;
  bio: string | null;
  location: string | null;
}

export type FriendshipRelationshipState =
  | 'self'
  | 'none'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'friends';

export interface FriendshipRelationship {
  memberId: string;
  state: FriendshipRelationshipState;
  requestId: string | null;
  friendshipId: string | null;
  friendsSince: string | null;
}

export interface FriendshipRequest {
  id: string;
  senderId: string;
  recipientId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  resolvedAt: string | null;
}

export interface FriendshipRequestListItem {
  request: FriendshipRequest;
  member: FriendshipMember;
}

export interface FriendshipListItem {
  friendshipId: string;
  friendsSince: string;
  member: FriendshipMember;
}

export interface FriendshipPage<T> {
  items: T[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface FriendshipMutationResult {
  request: FriendshipRequest;
  relationship: FriendshipRelationship;
}

export class FriendshipApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'FriendshipApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMember(value: unknown): FriendshipMember {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.displayName !== 'string' ||
      !(typeof value.bio === 'string' || value.bio === null) ||
      !(typeof value.location === 'string' || value.location === null)) {
    throw new FriendshipApiError('Thông tin thành viên nhận được không hợp lệ.');
  }
  return { id: value.id, displayName: value.displayName, bio: value.bio, location: value.location };
}

function parseRequest(value: unknown): FriendshipRequest {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.senderId !== 'string' ||
      typeof value.recipientId !== 'string' ||
      !['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(String(value.status)) ||
      typeof value.createdAt !== 'string' || !(typeof value.resolvedAt === 'string' || value.resolvedAt === null)) {
    throw new FriendshipApiError('Lời mời kết bạn nhận được không hợp lệ.');
  }
  return {
    id: value.id,
    senderId: value.senderId,
    recipientId: value.recipientId,
    status: value.status as FriendshipRequest['status'],
    createdAt: value.createdAt,
    resolvedAt: value.resolvedAt,
  };
}

function parseRelationship(value: unknown): FriendshipRelationship {
  if (!isRecord(value) || typeof value.memberId !== 'string' ||
      !['self', 'none', 'outgoing_pending', 'incoming_pending', 'friends'].includes(String(value.state)) ||
      !(typeof value.requestId === 'string' || value.requestId === null) ||
      !(typeof value.friendshipId === 'string' || value.friendshipId === null) ||
      !(typeof value.friendsSince === 'string' || value.friendsSince === null)) {
    throw new FriendshipApiError('Trạng thái kết nối nhận được không hợp lệ.');
  }
  return {
    memberId: value.memberId,
    state: value.state as FriendshipRelationshipState,
    requestId: value.requestId,
    friendshipId: value.friendshipId,
    friendsSince: value.friendsSince,
  };
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted || (isRecord(error) && error.name === 'AbortError')) throw error;
    throw new FriendshipApiError('Không thể kết nối đến dịch vụ. Vui lòng thử lại.');
  }

  if (!response.ok) {
    let detail: Record<string, unknown> | undefined;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error)) detail = payload.error;
    } catch {
      detail = undefined;
    }
    throw new FriendshipApiError(
      typeof detail?.message === 'string' ? detail.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
      response.status,
      typeof detail?.code === 'string' ? detail.code : undefined,
    );
  }

  if (response.status === 204) return undefined;
  try {
    return await response.json() as unknown;
  } catch (error) {
    if (init.signal?.aborted || (isRecord(error) && error.name === 'AbortError')) throw error;
    throw new FriendshipApiError('Phản hồi từ dịch vụ không hợp lệ.');
  }
}

async function getCsrfToken(): Promise<string> {
  const response = await requestJson('/auth/csrf');
  if (!isRecord(response) || typeof response.csrfToken !== 'string') {
    throw new FriendshipApiError('Không thể xác minh yêu cầu. Vui lòng tải lại trang.');
  }
  return response.csrfToken;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const csrfToken = await getCsrfToken();
  return requestJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  });
}

async function listPage<T>(path: string, parseItem: (value: unknown) => T, signal?: AbortSignal): Promise<FriendshipPage<T>> {
  const value = await requestJson(path, { signal });
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) {
    throw new FriendshipApiError('Danh sách kết bạn nhận được không hợp lệ.');
  }
  const { limit, hasMore, nextCursor } = value.pagination;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 50 ||
      typeof hasMore !== 'boolean' || !(typeof nextCursor === 'string' || nextCursor === null)) {
    throw new FriendshipApiError('Thông tin phân trang nhận được không hợp lệ.');
  }
  return {
    items: value.items.map(parseItem),
    pagination: { limit: limit as number, hasMore, nextCursor },
  };
}

export async function createFriendshipRequest(recipientId: string): Promise<FriendshipMutationResult> {
  const value = await postJson('/friendships/requests', { recipientId });
  if (!isRecord(value)) throw new FriendshipApiError('Phản hồi lời mời không hợp lệ.');
  return { request: parseRequest(value.request), relationship: parseRelationship(value.relationship) };
}

export async function listFriendshipRequests(input: {
  direction: 'received' | 'sent'; limit?: number; cursor?: string;
}, signal?: AbortSignal): Promise<FriendshipPage<FriendshipRequestListItem>> {
  const query = new URLSearchParams({ direction: input.direction });
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  return listPage(`/friendships/requests?${query}`, (value) => {
    if (!isRecord(value)) throw new FriendshipApiError('Lời mời kết bạn nhận được không hợp lệ.');
    return { request: parseRequest(value.request), member: parseMember(value.member) };
  }, signal);
}

export async function actOnFriendshipRequest(
  requestId: string,
  action: 'accept' | 'reject' | 'cancel',
): Promise<FriendshipMutationResult> {
  const value = await postJson(`/friendships/requests/${encodeURIComponent(requestId)}/${action}`, {});
  if (!isRecord(value)) throw new FriendshipApiError('Phản hồi lời mời không hợp lệ.');
  return { request: parseRequest(value.request), relationship: parseRelationship(value.relationship) };
}

export async function listFriendships(
  input: { limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<FriendshipPage<FriendshipListItem>> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  return listPage(`/friendships?${query}`, (value) => {
    if (!isRecord(value) || typeof value.friendshipId !== 'string' || typeof value.friendsSince !== 'string') {
      throw new FriendshipApiError('Thông tin tình bạn nhận được không hợp lệ.');
    }
    return { friendshipId: value.friendshipId, friendsSince: value.friendsSince, member: parseMember(value.member) };
  }, signal);
}

export async function getFriendshipRelationship(memberId: string, signal?: AbortSignal): Promise<FriendshipRelationship> {
  const value = await requestJson(`/friendships/status/${encodeURIComponent(memberId)}`, { signal });
  if (!isRecord(value)) throw new FriendshipApiError('Trạng thái kết nối nhận được không hợp lệ.');
  return parseRelationship(value.relationship);
}

export async function unfriend(friendshipId: string): Promise<void> {
  const csrfToken = await getCsrfToken();
  await requestJson(`/friendships/${encodeURIComponent(friendshipId)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}
