import { resolveApiUrl } from '../config/env';

export type HttpClientErrorKind = 'http' | 'invalid-json' | 'network';

export class HttpClientError extends Error {
  constructor(
    message: string,
    readonly kind: HttpClientErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpClientError';
  }
}

interface JsonRequestOptions {
  signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export async function getJson(
  path: string,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  const requestOptions: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json' },
  };
  if (options.signal) {
    requestOptions.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), requestOptions);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error;
    }

    throw new HttpClientError('Could not reach the API.', 'network');
  }

  if (!response.ok) {
    throw new HttpClientError(
      `The API returned HTTP ${response.status}.`,
      'http',
      response.status,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error;
    }

    throw new HttpClientError('The API returned invalid JSON.', 'invalid-json');
  }
}
