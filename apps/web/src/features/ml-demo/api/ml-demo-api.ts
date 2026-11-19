import { resolveApiUrl } from '../../../shared/config/env';

export type MlRecommendation = { sourceNodeId: string; candidateNodeId: string; rank: number; score: number };
export type RecommendationsResponse = {
  source: 'synthetic'; canViewAlerts: boolean; modelVersion: string | null; computedAt: string | null;
  items: MlRecommendation[];
};
export type AnomaliesResponse = {
  source: 'synthetic'; modelVersion: string; threshold: number; evaluatedCount: number;
  alerts: { actorId: string; evaluatedAt: string; anomalyScore: number }[];
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
        !body.alerts.every((alert) => alert && typeof alert === 'object' &&
          'actorId' in alert && typeof alert.actorId === 'string' &&
          'evaluatedAt' in alert && typeof alert.evaluatedAt === 'string' &&
          'anomalyScore' in alert && typeof alert.anomalyScore === 'number')) throw new MlDemoApiError();
    return body as AnomaliesResponse;
  });
