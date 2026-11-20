import { resolveApiUrl } from '../../../shared/config/env';

export type AnomalySeverity = 'normal' | 'suspicious' | 'high';

export interface AnomalyAccountReport {
  userId: string;
  email: string;
  displayName: string;
  auth1h: number;
  auth24h: number;
  failedLogin1h: number;
  failedLogin24h: number;
  friendReq1h: number;
  friendReq24h: number;
  post1h: number;
  post24h: number;
  comment1h: number;
  comment24h: number;
  distinctTargets1h: number;
  distinctTargets24h: number;
  lastActivityAt: string | null;
  recentVsPrior23h: number;
  anomalyScore: number;
  severity: AnomalySeverity;
  reasons: string[];
}

export interface AdminAnomaliesResponse {
  evaluatedAt: string;
  threshold: { suspicious: number; high: number };
  summary: {
    totalUsers: number;
    suspiciousCount: number;
    highRiskCount: number;
  };
  items: AnomalyAccountReport[];
}

export class AdminApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReportItem(value: unknown): AnomalyAccountReport {
  if (!isRecord(value) || typeof value.userId !== 'string' || typeof value.email !== 'string' ||
      typeof value.displayName !== 'string' || typeof value.anomalyScore !== 'number' ||
      !['normal', 'suspicious', 'high'].includes(String(value.severity)) ||
      !Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === 'string')) {
    throw new AdminApiError('Dữ liệu báo cáo bất thường không hợp lệ.');
  }
  return {
    userId: value.userId,
    email: value.email,
    displayName: value.displayName,
    auth1h: asNumber(value.auth1h),
    auth24h: asNumber(value.auth24h),
    failedLogin1h: asNumber(value.failedLogin1h),
    failedLogin24h: asNumber(value.failedLogin24h),
    friendReq1h: asNumber(value.friendReq1h),
    friendReq24h: asNumber(value.friendReq24h),
    post1h: asNumber(value.post1h),
    post24h: asNumber(value.post24h),
    comment1h: asNumber(value.comment1h),
    comment24h: asNumber(value.comment24h),
    distinctTargets1h: asNumber(value.distinctTargets1h),
    distinctTargets24h: asNumber(value.distinctTargets24h),
    lastActivityAt: typeof value.lastActivityAt === 'string' ? value.lastActivityAt : null,
    recentVsPrior23h: asNumber(value.recentVsPrior23h),
    anomalyScore: value.anomalyScore,
    severity: value.severity as AnomalySeverity,
    reasons: value.reasons,
  };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function getAdminAnomalies(signal?: AbortSignal): Promise<AdminAnomaliesResponse> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl('/admin/anomalies'), {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (signal?.aborted || (isRecord(error) && error.name === 'AbortError')) throw error;
    throw new AdminApiError('Không thể kết nối tới dịch vụ quản trị.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const detail = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    throw new AdminApiError(
      typeof detail?.message === 'string' ? detail.message : 'Chưa thể tải dữ liệu giám sát.',
      response.status,
      typeof detail?.code === 'string' ? detail.code : undefined,
    );
  }

  if (!isRecord(payload) || typeof payload.evaluatedAt !== 'string' ||
      !isRecord(payload.threshold) || !isRecord(payload.summary) || !Array.isArray(payload.items)) {
    throw new AdminApiError('Phản hồi từ trang quản trị không hợp lệ.');
  }

  return {
    evaluatedAt: payload.evaluatedAt,
    threshold: {
      suspicious: asNumber(payload.threshold.suspicious),
      high: asNumber(payload.threshold.high),
    },
    summary: {
      totalUsers: asNumber(payload.summary.totalUsers),
      suspiciousCount: asNumber(payload.summary.suspiciousCount),
      highRiskCount: asNumber(payload.summary.highRiskCount),
    },
    items: payload.items.map(parseReportItem),
  };
}
