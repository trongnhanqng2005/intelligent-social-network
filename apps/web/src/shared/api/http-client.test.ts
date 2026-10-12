import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson } from './http-client';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
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

describe('getJson', () => {
  it('requests a relative API path and returns untrusted JSON as unknown', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));

    await expect(getJson('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });

  it('surfaces non-success HTTP responses with their status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }));

    await expect(getJson('/health')).rejects.toMatchObject({
      name: 'HttpClientError',
      kind: 'http',
      status: 503,
    });
  });

  it('classifies invalid JSON without exposing parser details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('private parser detail')),
    } as unknown as Response);

    await expect(getJson('/health')).rejects.toMatchObject({
      name: 'HttpClientError',
      kind: 'invalid-json',
      message: 'The API returned invalid JSON.',
    });
  });

  it('classifies network failures and preserves aborts', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network detail'));
    await expect(getJson('/health')).rejects.toMatchObject({
      name: 'HttpClientError',
      kind: 'network',
      message: 'Could not reach the API.',
    });

    const abortError = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);
    await expect(getJson('/health')).rejects.toBe(abortError);
  });

  it('passes a supplied cancellation signal to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    const controller = new AbortController();

    await getJson('/health', { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  });
});
