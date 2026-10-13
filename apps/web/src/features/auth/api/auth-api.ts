import { resolveApiUrl } from '../../../shared/config/env';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: string;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUser(value: unknown): AuthUser {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.email !== 'string') {
    throw new AuthApiError('Phản hồi xác thực không hợp lệ.');
  }
  return { id: value.id, email: value.email };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch {
    throw new AuthApiError('Không thể kết nối đến dịch vụ. Vui lòng thử lại.');
  }

  if (!response.ok) {
    let error: unknown;
    try { error = await response.json(); } catch { error = undefined; }
    const detail = isRecord(error) && isRecord(error.error) ? error.error : undefined;
    const fieldErrors = isRecord(detail?.fieldErrors)
      ? Object.fromEntries(Object.entries(detail.fieldErrors).filter((entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string')))
      : undefined;
    throw new AuthApiError(
      typeof detail?.message === 'string' ? detail.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
      response.status,
      typeof detail?.code === 'string' ? detail.code : undefined,
      fieldErrors,
    );
  }

  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new AuthApiError('Phản hồi từ dịch vụ không hợp lệ.');
  }
}

export async function restoreSession(): Promise<AuthSession> {
  const result = await request<unknown>('/auth/session');
  if (!isRecord(result) || !isRecord(result.session) || typeof result.session.expiresAt !== 'string') {
    throw new AuthApiError('Phản hồi phiên đăng nhập không hợp lệ.');
  }
  return { user: parseUser(result.user), expiresAt: result.session.expiresAt };
}

async function csrfToken(): Promise<string> {
  const result = await request<unknown>('/auth/csrf');
  if (!isRecord(result) || typeof result.csrfToken !== 'string') {
    throw new AuthApiError('Không thể xác minh yêu cầu. Vui lòng tải lại trang.');
  }
  return result.csrfToken;
}

async function mutate<T>(path: string, body?: unknown): Promise<T> {
  const token = await csrfToken();
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const result = await mutate<unknown>('/auth/register', { email, password });
  if (!isRecord(result)) throw new AuthApiError('Phản hồi đăng ký không hợp lệ.');
  return parseUser(result.user);
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const result = await mutate<unknown>('/auth/login', { email, password });
  if (!isRecord(result) || !isRecord(result.session) || typeof result.session.expiresAt !== 'string') {
    throw new AuthApiError('Phản hồi đăng nhập không hợp lệ.');
  }
  return { user: parseUser(result.user), expiresAt: result.session.expiresAt };
}

export async function logout(): Promise<void> {
  await mutate<void>('/auth/logout');
}
