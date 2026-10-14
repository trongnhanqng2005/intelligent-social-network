import { resolveApiUrl } from '../../../shared/config/env';

export interface PublicProfile {
  id: string;
  displayName: string;
  bio: string | null;
  location: string | null;
}

export interface OwnProfile extends PublicProfile {
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemberDirectoryPage {
  items: PublicProfile[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface ProfileUpdateInput {
  expectedVersion: number;
  displayName?: string;
  bio?: string | null;
  location?: string | null;
}

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'UserApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePublicProfile(value: unknown): PublicProfile {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.displayName !== 'string' ||
      !(typeof value.bio === 'string' || value.bio === null) ||
      !(typeof value.location === 'string' || value.location === null)) {
    throw new UserApiError('Hồ sơ nhận được không hợp lệ.');
  }
  return { id: value.id, displayName: value.displayName, bio: value.bio, location: value.location };
}

function parseOwnProfile(value: unknown): OwnProfile {
  const profile = parsePublicProfile(value);
  if (!isRecord(value) || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
    throw new UserApiError('Hồ sơ nhận được không hợp lệ.');
  }
  return { ...profile, createdAt: value.createdAt, updatedAt: value.updatedAt, version: value.version as number };
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
    throw new UserApiError('Không thể kết nối đến dịch vụ. Vui lòng thử lại.');
  }

  if (!response.ok) {
    let detail: Record<string, unknown> | undefined;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error)) detail = payload.error;
    } catch {
      detail = undefined;
    }
    const fieldErrors = isRecord(detail?.fieldErrors)
      ? Object.fromEntries(Object.entries(detail.fieldErrors).filter((entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string')))
      : undefined;
    throw new UserApiError(
      typeof detail?.message === 'string' ? detail.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
      response.status,
      typeof detail?.code === 'string' ? detail.code : undefined,
      fieldErrors,
    );
  }

  try {
    return await response.json() as unknown;
  } catch (error) {
    if (init.signal?.aborted || (isRecord(error) && error.name === 'AbortError')) throw error;
    throw new UserApiError('Phản hồi từ dịch vụ không hợp lệ.');
  }
}

async function getCsrfToken(): Promise<string> {
  const response = await requestJson('/auth/csrf');
  if (!isRecord(response) || typeof response.csrfToken !== 'string') {
    throw new UserApiError('Không thể xác minh yêu cầu. Vui lòng tải lại trang.');
  }
  return response.csrfToken;
}

export async function getOwnProfile(signal?: AbortSignal): Promise<OwnProfile> {
  const response = await requestJson('/users/me/profile', { signal });
  if (!isRecord(response)) throw new UserApiError('Hồ sơ nhận được không hợp lệ.');
  return parseOwnProfile(response.profile);
}

export async function updateOwnProfile(input: ProfileUpdateInput): Promise<OwnProfile> {
  const csrfToken = await getCsrfToken();
  const response = await requestJson('/users/me/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  });
  if (!isRecord(response)) throw new UserApiError('Hồ sơ nhận được không hợp lệ.');
  return parseOwnProfile(response.profile);
}

export async function getMemberProfile(id: string, signal?: AbortSignal): Promise<PublicProfile> {
  const response = await requestJson(`/users/${encodeURIComponent(id)}/profile`, { signal });
  if (!isRecord(response)) throw new UserApiError('Hồ sơ nhận được không hợp lệ.');
  return parsePublicProfile(response.profile);
}

export async function listMembers(
  input: { q?: string; limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<MemberDirectoryPage> {
  const query = new URLSearchParams();
  if (input.q !== undefined) query.set('q', input.q);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  const response = await requestJson(`/users?${query.toString()}`, { signal });
  if (!isRecord(response) || !Array.isArray(response.items) || !isRecord(response.pagination)) {
    throw new UserApiError('Danh sách thành viên nhận được không hợp lệ.');
  }
  const { limit, hasMore, nextCursor } = response.pagination;
  if (!Number.isInteger(limit) || typeof hasMore !== 'boolean' ||
      !(typeof nextCursor === 'string' || nextCursor === null)) {
    throw new UserApiError('Danh sách thành viên nhận được không hợp lệ.');
  }
  return {
    items: response.items.map(parsePublicProfile),
    pagination: { limit: limit as number, hasMore, nextCursor },
  };
}
