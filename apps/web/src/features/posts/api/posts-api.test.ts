import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPost,
  deletePost,
  listFeed,
  listMemberPosts,
  PostsApiError,
  updatePost,
} from './posts-api';

const fetchMock = vi.fn<typeof fetch>();
const author = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Nguyễn An', bio: null, location: null,
};
const post = {
  id: '22222222-2222-4222-8222-222222222222',
  content: 'Xin chào\n🌱', visibility: 'friends',
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
  version: 0, author, permissions: { canEdit: true, canDelete: true },
};

function response(body: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Posts API client', () => {
  it('gets CSRF before creating a no-store JSON Post and parses only the explicit projection', async () => {
    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response({ post }));
    await expect(createPost({ content: 'Xin chào', visibility: 'friends' })).resolves.toEqual(post);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/posts', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' },
      body: JSON.stringify({ content: 'Xin chào', visibility: 'friends' }),
    })]);
  });

  it('uses no-store GET requests and encodes keyset cursors for Feed and member Posts', async () => {
    const page = { items: [post], pagination: { limit: 20, hasMore: false, nextCursor: null } };
    fetchMock.mockResolvedValueOnce(response(page)).mockResolvedValueOnce(response(page));
    await listFeed({ limit: 20, cursor: 'cursor==' });
    await listMemberPosts(author.id, { cursor: 'member-cursor' });
    const feedUrl = new URL(String(fetchMock.mock.calls[0]![0]), 'https://local.test');
    const profileUrl = new URL(String(fetchMock.mock.calls[1]![0]), 'https://local.test');
    expect(feedUrl.pathname).toBe('/api/feed');
    expect(feedUrl.searchParams.get('cursor')).toBe('cursor==');
    expect(profileUrl.pathname).toBe(`/api/users/${author.id}/posts`);
    expect(profileUrl.searchParams.get('cursor')).toBe('member-cursor');
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === 'no-store')).toBe(true);
  });

  it('submits expectedVersion for edit and delete without a DELETE body or automatic retry', async () => {
    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response({ post: { ...post, content: 'Sửa', version: 1 } }))
      .mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    await updatePost(post.id, { content: 'Sửa', expectedVersion: 0 });
    await deletePost(post.id, 1);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: 'PATCH', body: JSON.stringify({ content: 'Sửa', expectedVersion: 0 }),
    });
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[3]!;
    expect(new URL(String(deleteUrl), 'https://local.test').searchParams.get('expectedVersion')).toBe('1');
    expect(deleteInit).toMatchObject({ method: 'DELETE', cache: 'no-store', credentials: 'same-origin' });
    expect(deleteInit?.body).toBeUndefined();

    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response({ error: { code: 'WRITE_OUTCOME_UNKNOWN', message: 'Unknown' } }, { ok: false, status: 503 }));
    await expect(createPost({ content: 'Draft', visibility: 'friends' })).rejects.toMatchObject({
      status: 503, code: 'WRITE_OUTCOME_UNKNOWN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['a committed Post whose successful response was lost', () => fetchMock.mockRejectedValueOnce(new TypeError('connection reset'))],
    ['a successful response with an invalid projection', () => fetchMock.mockResolvedValueOnce(response({ post: { ...post, version: 'invalid' } }))],
  ])('marks %s as an uncertain create outcome', async (_scenario, configureCreateResponse) => {
    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf' }));
    configureCreateResponse();

    await expect(createPost({ content: 'Keep this draft', visibility: 'friends' })).rejects.toMatchObject({
      status: 503,
      code: 'WRITE_OUTCOME_UNKNOWN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed response projections and preserves validation field errors', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [{ ...post, author: undefined }],
      pagination: { limit: 20, hasMore: false, nextCursor: null } }));
    await expect(listFeed({})).rejects.toBeInstanceOf(PostsApiError);
    fetchMock.mockResolvedValueOnce(response({ csrfToken: 'csrf' }))
      .mockResolvedValueOnce(response({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', fieldErrors: { content: ['Too long'] } } }, { ok: false, status: 422 }));
    await expect(createPost({ content: 'x', visibility: 'friends' })).rejects.toMatchObject({
      status: 422, fieldErrors: { content: ['Too long'] },
    });
  });
});
