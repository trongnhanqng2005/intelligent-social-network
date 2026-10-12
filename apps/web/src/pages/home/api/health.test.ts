import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkApiHealth, HealthResponseError, parseHealthResponse } from './health';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('health response validation', () => {
  it('accepts only a valid process-liveness response', () => {
    expect(parseHealthResponse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it.each([null, 'ok', [], {}, { status: 'down' }, { status: 200 }])(
    'rejects an invalid health payload: %s',
    (payload) => {
      expect(() => parseHealthResponse(payload)).toThrow(HealthResponseError);
    },
  );

  it('requests the health endpoint through the centralized client', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: 'ok' }),
    } as unknown as Response);

    await expect(checkApiHealth()).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });
});
