import { resolveApiUrl } from '../../../shared/config/env';

export type PostVisibility = 'members' | 'friends';

export interface PostAuthor {
  id: string;
  displayName: string;
  bio: string | null;
  location: string | null;
}

export interface PostView {
  id: string;
  content: string;
  visibility: PostVisibility;
  createdAt: string;
  updatedAt: string;
  version: number;
  author: PostAuthor;
  permissions: { canEdit: boolean; canDelete: boolean };
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
}

export interface PostComment { id: string; clientId: string; postId: string; content: string; createdAt: string; updatedAt: string; version: number; deleted: boolean; author: { id: string; displayName: string }; permissions: { canEdit: boolean; canDelete: boolean } }

export interface CommentsPage {
  items: PostComment[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface PostsPage {
  items: PostView[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export class PostsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'PostsApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePost(value: unknown): PostView {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string' ||
      (value.visibility !== 'members' && value.visibility !== 'friends') ||
      typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 0 ||
      !isRecord(value.author) || typeof value.author.id !== 'string' ||
      typeof value.author.displayName !== 'string' ||
      !(typeof value.author.bio === 'string' || value.author.bio === null) ||
      !(typeof value.author.location === 'string' || value.author.location === null) ||
      !isRecord(value.permissions) || typeof value.permissions.canEdit !== 'boolean' ||
      typeof value.permissions.canDelete !== 'boolean' || !Number.isSafeInteger(value.likeCount) ||
      !Number.isSafeInteger(value.commentCount) || typeof value.likedByViewer !== 'boolean') {
    throw new PostsApiError('Bài viết nhận được không hợp lệ.');
  }
  return {
    id: value.id,
    content: value.content,
    visibility: value.visibility,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version as number,
    author: {
      id: value.author.id,
      displayName: value.author.displayName,
      bio: value.author.bio,
      location: value.author.location,
    },
    permissions: { canEdit: value.permissions.canEdit, canDelete: value.permissions.canDelete },
    likeCount: value.likeCount as number, commentCount: value.commentCount as number, likedByViewer: value.likedByViewer,
  };
}

export async function setPostLike(postId: string, liked: boolean): Promise<void> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(resolveApiUrl(`/posts/${encodeURIComponent(postId)}/like`), {
    method: liked ? 'PUT' : 'DELETE', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken },
  });
  if (!response.ok) throw await readMutationError(response);
}

function parseComment(value: unknown): PostComment {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.clientId !== 'string' ||
      typeof value.postId !== 'string' || typeof value.content !== 'string' || typeof value.createdAt !== 'string' ||
      typeof value.updatedAt !== 'string' || !Number.isSafeInteger(value.version) || (value.version as number) < 0 ||
      typeof value.deleted !== 'boolean' || !isRecord(value.author) || typeof value.author.id !== 'string' ||
      typeof value.author.displayName !== 'string' || !isRecord(value.permissions) ||
      typeof value.permissions.canEdit !== 'boolean' || typeof value.permissions.canDelete !== 'boolean') {
    throw new PostsApiError('Bình luận nhận được không hợp lệ.');
  }
  return { id: value.id, clientId: value.clientId, postId: value.postId, content: value.content,
    createdAt: value.createdAt, updatedAt: value.updatedAt, version: value.version as number, deleted: value.deleted,
    author: { id: value.author.id, displayName: value.author.displayName },
    permissions: { canEdit: value.permissions.canEdit, canDelete: value.permissions.canDelete } };
}

function parseCommentsPage(value: unknown): CommentsPage {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) throw new PostsApiError('Danh sách bình luận nhận được không hợp lệ.');
  const { limit, hasMore, nextCursor } = value.pagination;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50 || typeof hasMore !== 'boolean' ||
      !(typeof nextCursor === 'string' || nextCursor === null) || (hasMore && typeof nextCursor !== 'string')) {
    throw new PostsApiError('Phân trang bình luận nhận được không hợp lệ.');
  }
  return { items: value.items.map(parseComment), pagination: { limit: limit as number, hasMore, nextCursor } };
}

function parseCommentEnvelope(value: unknown): { comment: PostComment } {
  if (!isRecord(value)) throw new PostsApiError('Bình luận nhận được không hợp lệ.');
  return { comment: parseComment(value.comment) };
}

export async function listComments(postId: string, input: { limit?: number; cursor?: string } = {}, signal?: AbortSignal): Promise<CommentsPage> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  return parseCommentsPage(await requestJson(`/posts/${encodeURIComponent(postId)}/comments?${query}`, { signal }));
}
export async function createComment(postId: string, clientId: string, content: string): Promise<{ comment: PostComment }> {
  const csrfToken = await getCsrfToken();
  return parseCommentEnvelope(await requestJson(`/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ clientId, content }),
  }));
}
export async function updateComment(postId: string, commentId: string, content: string, expectedVersion: number): Promise<{ comment: PostComment }> {
  const csrfToken = await getCsrfToken();
  return parseCommentEnvelope(await requestJson(`/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ content, expectedVersion }),
  }));
}
export async function deleteComment(postId: string, commentId: string, expectedVersion: number): Promise<void> {
  const csrfToken = await getCsrfToken();
  const path = `/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}?${new URLSearchParams({ expectedVersion: String(expectedVersion) })}`;
  const response = await fetch(resolveApiUrl(path), { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken } });
  if (!response.ok) throw await readMutationError(response);
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
    throw new PostsApiError('Không thể kết nối đến dịch vụ. Vui lòng thử lại.');
  }
  if (!response.ok) throw await readApiError(response);
  try {
    return await response.json() as unknown;
  } catch (error) {
    if (init.signal?.aborted || (isRecord(error) && error.name === 'AbortError')) throw error;
    throw new PostsApiError('Phản hồi từ dịch vụ không hợp lệ.');
  }
}

async function readApiError(response: Response): Promise<PostsApiError> {
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
  return new PostsApiError(
    typeof detail?.message === 'string' ? detail.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
    response.status,
    typeof detail?.code === 'string' ? detail.code : undefined,
    fieldErrors,
  );
}

async function getCsrfToken(): Promise<string> {
  const payload = await requestJson('/auth/csrf');
  if (!isRecord(payload) || typeof payload.csrfToken !== 'string') {
    throw new PostsApiError('Không thể xác minh yêu cầu. Vui lòng tải lại trang.');
  }
  return payload.csrfToken;
}

function parsePage(value: unknown): PostsPage {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) {
    throw new PostsApiError('Danh sách bài viết nhận được không hợp lệ.');
  }
  const { limit, hasMore, nextCursor } = value.pagination;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50 ||
      typeof hasMore !== 'boolean' || !(typeof nextCursor === 'string' || nextCursor === null) ||
      (hasMore && typeof nextCursor !== 'string')) {
    throw new PostsApiError('Phân trang bài viết nhận được không hợp lệ.');
  }
  return { items: value.items.map(parsePost), pagination: { limit: limit as number, hasMore, nextCursor } };
}

function parsePostEnvelope(value: unknown): PostView {
  if (!isRecord(value)) throw new PostsApiError('Bài viết nhận được không hợp lệ.');
  return parsePost(value.post);
}

export async function createPost(input: { content: string; visibility: PostVisibility }): Promise<PostView> {
  const csrfToken = await getCsrfToken();
  let response: Response;
  try {
    response = await fetch(resolveApiUrl('/posts'), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw unknownCreateOutcome();
  }
  if (!response.ok) throw await readApiError(response);

  try {
    return parsePostEnvelope(await response.json() as unknown);
  } catch {
    throw unknownCreateOutcome();
  }
}

function unknownCreateOutcome(): PostsApiError {
  return new PostsApiError(
    'Chưa thể xác nhận kết quả đăng bài. Hãy tải lại bảng tin để kiểm tra trước khi gửi lại.',
    503,
    'WRITE_OUTCOME_UNKNOWN',
  );
}

export async function getPost(postId: string, signal?: AbortSignal): Promise<PostView> {
  return parsePostEnvelope(await requestJson(`/posts/${encodeURIComponent(postId)}`, { signal }));
}

export async function updatePost(
  postId: string,
  input: { content: string; expectedVersion: number },
): Promise<PostView> {
  const csrfToken = await getCsrfToken();
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(`/posts/${encodeURIComponent(postId)}`), {
      method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(input),
    });
  } catch {
    throw unknownMutationOutcome();
  }
  if (!response.ok) throw await readMutationError(response);
  try {
    return parsePostEnvelope(await response.json() as unknown);
  } catch {
    throw unknownMutationOutcome();
  }
}

function unknownMutationOutcome(): PostsApiError {
  return new PostsApiError('Chưa thể xác nhận kết quả. Hãy tải lại bài viết trước khi thử lại.', 503, 'WRITE_OUTCOME_UNKNOWN');
}

async function readMutationError(response: Response): Promise<PostsApiError> {
  const error = await readApiError(response);
  if (response.status >= 500 && !['WRITE_OUTCOME_UNKNOWN', 'POST_DATA_INCONSISTENT', 'SERVICE_UNAVAILABLE'].includes(error.code ?? '')) {
    return unknownMutationOutcome();
  }
  return error;
}

export async function deletePost(postId: string, expectedVersion: number): Promise<void> {
  const csrfToken = await getCsrfToken();
  const path = `/posts/${encodeURIComponent(postId)}?${new URLSearchParams({ expectedVersion: String(expectedVersion) })}`;
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken },
    });
  } catch {
    throw unknownMutationOutcome();
  }
  if (!response.ok) throw await readMutationError(response);
}

export async function listFeed(input: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<PostsPage> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  return parsePage(await requestJson(`/feed?${query.toString()}`, { signal }));
}

export async function listMemberPosts(
  memberId: string,
  input: { limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<PostsPage> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.cursor !== undefined) query.set('cursor', input.cursor);
  return parsePage(await requestJson(`/users/${encodeURIComponent(memberId)}/posts?${query.toString()}`, { signal }));
}
