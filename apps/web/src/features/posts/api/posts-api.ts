import { resolveApiUrl } from '../../../shared/config/env';

export interface FeedPost {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; displayName: string };
  mine: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  likedByMe: boolean;
  sharedByMe: boolean;
}

export interface FeedComment {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  author: { id: string; displayName: string };
  mine: boolean;
}

export interface FeedPage {
  items: FeedPost[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export class PostsApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'PostsApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...init.headers },
  });
  if (!response.ok) {
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await response.json() as Record<string, unknown>;
      detail = body.error as Record<string, unknown> | undefined;
    } catch { /* response may have no JSON body */ }
    throw new PostsApiError(
      typeof detail?.message === 'string' ? detail.message : 'Không thể thực hiện yêu cầu bài viết.',
      response.status,
      typeof detail?.code === 'string' ? detail.code : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function csrf(): Promise<string> {
  const result = await request<{ csrfToken?: string }>('/auth/csrf');
  if (!result.csrfToken) throw new PostsApiError('Không thể xác minh yêu cầu.');
  return result.csrfToken;
}

export async function listFeed(cursor?: string, signal?: AbortSignal): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request<FeedPage>(`/posts/feed${query}`, { signal });
}

export async function createPost(content: string): Promise<FeedPost> {
  const token = await csrf();
  const result = await request<{ post: FeedPost }>('/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ content }),
  });
  return result.post;
}

export async function updatePost(id: string, content: string): Promise<FeedPost> {
  const token = await csrf();
  const result = await request<{ post: FeedPost }>(`/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ content }),
  });
  return result.post;
}

export async function deletePost(id: string): Promise<void> {
  const token = await csrf();
  await request<void>(`/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': token },
  });
}

export async function toggleLike(id: string, active: boolean): Promise<void> {
  await mutatePost(`/posts/${encodeURIComponent(id)}/like`, active ? 'POST' : 'DELETE');
}

export async function toggleShare(id: string, active: boolean): Promise<void> {
  await mutatePost(`/posts/${encodeURIComponent(id)}/share`, active ? 'POST' : 'DELETE');
}

async function mutatePost(path: string, method: 'POST' | 'DELETE'): Promise<void> {
  const token = await csrf();
  await request<void>(path, { method, headers: { 'X-CSRF-Token': token } });
}

export async function listComments(id: string): Promise<FeedComment[]> {
  const result = await request<{ items: FeedComment[] }>(`/posts/${encodeURIComponent(id)}/comments`);
  return result.items;
}

export async function createComment(id: string, content: string): Promise<FeedComment> {
  const token = await csrf();
  const result = await request<{ comment: FeedComment }>(`/posts/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ content }),
  });
  return result.comment;
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const token = await csrf();
  await request<void>(`/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': token },
  });
}
