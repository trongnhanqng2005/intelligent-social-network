import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiHealth } from './use-api-health';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('useApiHealth', () => {
  it('shows loading and then success only after a valid response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));

    const { result } = renderHook(() => useApiHealth());
    expect(result.current.state.status).toBe('loading');

    await waitFor(() => expect(result.current.state.status).toBe('success'));
  });

  it('shows an actionable error when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('network detail'));

    const { result } = renderHook(() => useApiHealth());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The API could not be reached. Check that the backend is running.',
    });
  });

  it('reports HTTP failures without presenting the API as connected', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    } as unknown as Response);

    const { result } = renderHook(() => useApiHealth());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The API returned HTTP 503.',
    });
  });

  it('reports invalid JSON without exposing parser details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('private parser detail')),
    } as unknown as Response);

    const { result } = renderHook(() => useApiHealth());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The API returned invalid JSON.',
    });
  });

  it('does not treat an unexpected health payload as success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'down' }));

    const { result } = renderHook(() => useApiHealth());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The API returned an unexpected health response.',
    });
  });

  it('retries after failure and can recover', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network detail'))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const { result } = renderHook(() => useApiHealth());
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a bounded request timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    const { result } = renderHook(() => useApiHealth());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The API request timed out after 5 seconds.',
    });
  });

  it('aborts an obsolete request when the hook unmounts', () => {
    let requestSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((_input, options) => {
      requestSignal = options?.signal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useApiHealth());
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it('ignores a late invalid response from an obsolete request', async () => {
    let resolveObsolete: ((response: Response) => void) | undefined;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveObsolete = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const { result } = renderHook(() => useApiHealth());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state.status).toBe('success'));
    expect(resolveObsolete).toBeDefined();

    await act(async () => {
      resolveObsolete?.(jsonResponse({ status: 'down' }));
    });

    expect(result.current.state).toEqual({ status: 'success' });
  });
});
