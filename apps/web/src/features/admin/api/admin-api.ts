import { resolveApiUrl } from '../../../shared/config/env';

export type Member = { id: string; email: string; displayName: string; role: string; locked: boolean };
export type ModeratedItem = { id: string; authorId: string; authorName: string; content: string; createdAt: string; hidden: boolean; postId?: string };

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(resolveApiUrl(path), {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
async function items<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const data: unknown = await (await request(path, { signal })).json();
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) throw new Error('Invalid response');
  return data.items as T[];
}
export const ADMIN_PAGE_SIZE = 50;

function listParams(q: string, state: string, page: number): string {
  return new URLSearchParams({ q, state, offset: String(page * ADMIN_PAGE_SIZE), limit: String(ADMIN_PAGE_SIZE + 1) }).toString();
}

export const getMembers = (q: string, state: string, page: number, signal: AbortSignal) =>
  items<Member>(`/admin/members?${listParams(q, state, page)}`, signal);
export const getModeratedItems = (type: 'posts' | 'comments', q: string, state: string, page: number, signal: AbortSignal) =>
  items<ModeratedItem>(`/admin/${type}?${listParams(q, state, page)}`, signal);

export async function updateAdminState(path: string, body: { locked?: boolean; hidden?: boolean }): Promise<void> {
  const csrf = await request('/auth/csrf');
  const tokenData: unknown = await csrf.json();
  if (!tokenData || typeof tokenData !== 'object' || !('csrfToken' in tokenData) || typeof tokenData.csrfToken !== 'string') throw new Error('Invalid CSRF token');
  await request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tokenData.csrfToken },
    body: JSON.stringify(body),
  });
}
