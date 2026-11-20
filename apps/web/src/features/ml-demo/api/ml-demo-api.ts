import { resolveApiUrl } from '../../../shared/config/env';

export type MlRecommendation = { sourceNodeId: string; candidateNodeId: string; rank: number; score: number };
export type RecommendationsResponse = {
  source: 'synthetic'; canViewAlerts: boolean; modelVersion: string | null; computedAt: string | null;
  items: MlRecommendation[];
};
export type AnomaliesResponse = {
  source: 'synthetic'; snapshotId: string; modelVersion: string; threshold: number; evaluatedCount: number;
  alerts: { actorId: string; evaluatedAt: string; anomalyScore: number; reviewedAt: string | null }[];
};

export class MlDemoApiError extends Error {
  constructor(readonly status?: number) { super('Không thể tải dữ liệu nghiên cứu.'); }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MlDemoApiError();
  }
  if (!response.ok) throw new MlDemoApiError(response.status);
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as T;
  } catch {
    throw new MlDemoApiError(response.status);
  }
}

export const getRecommendations = (signal?: AbortSignal) =>
  get<unknown>('/ml-demo/recommendations', signal).then((body) => {
    if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items) ||
        !('canViewAlerts' in body) || typeof body.canViewAlerts !== 'boolean' ||
        !body.items.every((item) => item && typeof item === 'object' &&
          'sourceNodeId' in item && typeof item.sourceNodeId === 'string' &&
          'candidateNodeId' in item && typeof item.candidateNodeId === 'string' &&
          'rank' in item && typeof item.rank === 'number' && 'score' in item && typeof item.score === 'number')) {
      throw new MlDemoApiError();
    }
    return body as RecommendationsResponse;
  });
export const getAnomalies = (signal?: AbortSignal) =>
  get<unknown>('/ml-demo/anomalies', signal).then((body) => {
    if (!body || typeof body !== 'object' || !('alerts' in body) || !Array.isArray(body.alerts) ||
        !('evaluatedCount' in body) || typeof body.evaluatedCount !== 'number' ||
        !('threshold' in body) || typeof body.threshold !== 'number' ||
        !('modelVersion' in body) || typeof body.modelVersion !== 'string' ||
        !('snapshotId' in body) || typeof body.snapshotId !== 'string' ||
        !body.alerts.every((alert) => alert && typeof alert === 'object' &&
          'actorId' in alert && typeof alert.actorId === 'string' &&
          'evaluatedAt' in alert && typeof alert.evaluatedAt === 'string' &&
          'anomalyScore' in alert && typeof alert.anomalyScore === 'number' &&
          'reviewedAt' in alert && (alert.reviewedAt === null || typeof alert.reviewedAt === 'string'))) throw new MlDemoApiError();
    return body as AnomaliesResponse;
  });

export async function reviewAnomaly(snapshotId: string, actorId: string): Promise<string> {
  const csrfResponse = await fetch(resolveApiUrl('/auth/csrf'), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!csrfResponse.ok) throw new MlDemoApiError(csrfResponse.status);
  const csrfBody: unknown = await csrfResponse.json();
  if (!csrfBody || typeof csrfBody !== 'object' || !('csrfToken' in csrfBody) || typeof csrfBody.csrfToken !== 'string') throw new MlDemoApiError();
  const response = await fetch(resolveApiUrl('/ml-demo/anomalies/review'), {
    method: 'PUT', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfBody.csrfToken },
    body: JSON.stringify({ snapshotId, actorId }),
  });
  if (!response.ok) throw new MlDemoApiError(response.status);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('reviewedAt' in body) || typeof body.reviewedAt !== 'string') throw new MlDemoApiError();
  return body.reviewedAt;
}
