import { getJson } from '../../../shared/api/http-client';

export interface ApiHealthResponse {
  status: 'ok';
}

export class HealthResponseError extends Error {
  constructor() {
    super('The API returned an unexpected health response.');
    this.name = 'HealthResponseError';
  }
}

export function parseHealthResponse(payload: unknown): ApiHealthResponse {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    !('status' in payload) ||
    payload.status !== 'ok'
  ) {
    throw new HealthResponseError();
  }

  return { status: 'ok' };
}

export async function checkApiHealth(
  options: { signal?: AbortSignal } = {},
): Promise<ApiHealthResponse> {
  const payload = await getJson('/health', options);
  return parseHealthResponse(payload);
}
