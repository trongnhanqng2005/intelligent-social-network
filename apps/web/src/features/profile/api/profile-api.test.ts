import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOwnProfile, listMembers, updateOwnProfile, UserApiError } from './profile-api';

const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const profile = {
  id: 'd723b01f-7048-4efd-80c7-2d59cfb88319',
  displayName: 'Nguyễn An', bio: null, location: null,
  createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', version: 0,
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('profile API', () => {
  it('fetches protected profile data without caching and validates the response', async () => {
    fetchMock.mockResolvedValue(response({ profile }));
    await expect(getOwnProfile()).resolves.toEqual(profile);
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/profile', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    }));
  });

  it('fetches a CSRF token before PATCH and submits only JSON with the expected version', async () => {
    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(response({ profile: { ...profile, displayName: 'Minh An', version: 1 } }));
    await updateOwnProfile({ displayName: 'Minh An', expectedVersion: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/csrf');
    expect(fetchMock.mock.calls[1]).toEqual(['/api/users/me/profile', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      body: JSON.stringify({ displayName: 'Minh An', expectedVersion: 0 }),
    })]);
  });

  it('serializes query and cursor parameters and parses a bounded directory page', async () => {
    fetchMock.mockResolvedValue(response({
      items: [{ id: profile.id, displayName: 'Nguyễn An', bio: null, location: null }],
      pagination: { limit: 20, hasMore: false, nextCursor: null },
    }));
    await listMembers({ q: 'Nguyễn & Đặng', limit: 20, cursor: 'cursor==' });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]), 'https://local.test');
    expect(requestedUrl.pathname).toBe('/api/users');
    expect(requestedUrl.searchParams.get('q')).toBe('Nguyễn & Đặng');
    expect(requestedUrl.searchParams.get('limit')).toBe('20');
    expect(requestedUrl.searchParams.get('cursor')).toBe('cursor==');
  });

  it('preserves structured service errors and aborts', async () => {
    fetchMock.mockResolvedValue(response({ error: { code: 'PROFILE_CONFLICT', message: 'Conflict' } }, { ok: false, status: 409 }));
    await expect(getOwnProfile()).rejects.toMatchObject({ status: 409, code: 'PROFILE_CONFLICT' });
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(getOwnProfile()).rejects.toMatchObject({ name: 'AbortError' });
    expect(UserApiError).toBeDefined();
  });
});
