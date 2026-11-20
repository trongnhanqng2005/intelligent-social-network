import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { open } from 'node:fs/promises';
import { isAllowedUserId } from '../../config/uuid-allowlist.js';
import { AuthPrincipal } from '../auth/auth-session.guard.js';

type Recommendation = { sourceNodeId: string; candidateNodeId: string; rank: number; score: number };
type Alert = { actorId: string; evaluatedAt: string; anomalyScore: number };
type Snapshot = {
  schemaVersion: 1; source: 'synthetic'; recommendationModelVersion: string | null;
  anomalyModelVersion: string; computedAt: string | null;
  recommendations: Recommendation[]; threshold: number; evaluatedCount: number; alerts: Alert[];
};

@Injectable()
export class MlDemoService {
  constructor(private readonly config: ConfigService) {}

  canViewAlerts(user: AuthPrincipal): boolean {
    return isAllowedUserId(this.config, 'ML_DEMO_ALERT_REVIEWER_IDS', user.id);
  }

  async recommendations(user: AuthPrincipal) {
    const snapshot = await this.loadSnapshot();
    return {
      source: 'synthetic' as const,
      canViewAlerts: this.canViewAlerts(user),
      modelVersion: snapshot.recommendationModelVersion,
      computedAt: snapshot.computedAt,
      items: snapshot.recommendations,
    };
  }

  async anomalies(user: AuthPrincipal) {
    if (!this.canViewAlerts(user)) throw new ForbiddenException({
      error: { code: 'ML_DEMO_FORBIDDEN', message: 'Bạn không có quyền xem phần nghiên cứu này.' },
    });
    const snapshot = await this.loadSnapshot();
    return {
      source: 'synthetic' as const,
      modelVersion: snapshot.anomalyModelVersion,
      threshold: snapshot.threshold,
      evaluatedCount: snapshot.evaluatedCount,
      alerts: snapshot.alerts,
    };
  }

  private async loadSnapshot(): Promise<Snapshot> {
    const path = this.config.get<string>('ML_DEMO_BUNDLE_PATH');
    if (!path) throw unavailable();
    try {
      const file = await open(path, 'r');
      try {
        if (!(await file.stat()).isFile()) throw new Error();
        const bytes = Buffer.alloc(2_000_001);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead > 2_000_000) throw new Error();
        return validateSnapshot(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
      } finally {
        await file.close();
      }
    } catch {
      throw unavailable();
    }
  }
}

function unavailable() {
  return new ServiceUnavailableException({
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Dữ liệu nghiên cứu tổng hợp hiện chưa khả dụng.' },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}
function validateSnapshot(value: unknown): Snapshot {
  const root = value as Record<string, unknown>;
  if (!record(value) || !exact(root, ['schemaVersion','source','recommendationModelVersion','anomalyModelVersion','computedAt','recommendations','threshold','evaluatedCount','alerts']) ||
      root.schemaVersion !== 1 || root.source !== 'synthetic' ||
       !(root.recommendationModelVersion === null || (typeof root.recommendationModelVersion === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(root.recommendationModelVersion))) ||
      typeof root.anomalyModelVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(root.anomalyModelVersion) ||
       !(root.computedAt === null || validDate(root.computedAt)) ||
       ((root.recommendations as unknown[])?.length !== 0 && (root.computedAt === null || root.recommendationModelVersion === null)) ||
       !validScore(root.threshold) ||
       !Number.isSafeInteger(root.evaluatedCount) || (root.evaluatedCount as number) < 0 || (root.evaluatedCount as number) > 1000 ||
       !Array.isArray(root.recommendations) || root.recommendations.length > 2000 ||
      !Array.isArray(root.alerts) || root.alerts.length > (root.evaluatedCount as number)) throw new Error();
  const groups = new Map<string, Recommendation[]>();
  const pairs = new Set<string>();
  for (const item of root.recommendations) {
    if (!record(item) || !exact(item, ['sourceNodeId','candidateNodeId','rank','score']) ||
        typeof item.sourceNodeId !== 'string' || !/^synthetic-friend-rec-v1:(0|[1-9][0-9]*)$/.test(item.sourceNodeId) ||
        typeof item.candidateNodeId !== 'string' || !/^synthetic-friend-rec-v1:(0|[1-9][0-9]*)$/.test(item.candidateNodeId) ||
        item.sourceNodeId === item.candidateNodeId || !Number.isInteger(item.rank) ||
        (item.rank as number) < 1 || (item.rank as number) > 10 || !validScore(item.score) ||
        item.score < 0) throw new Error();
    const pair = `${item.sourceNodeId}\0${item.candidateNodeId}`;
    if (pairs.has(pair)) throw new Error();
    pairs.add(pair);
    const group = groups.get(item.sourceNodeId) ?? [];
    group.push(item as Recommendation);
    groups.set(item.sourceNodeId, group);
  }
  for (const group of groups.values()) {
    group.sort((a,b) => a.rank - b.rank);
    if (group.some((item, index) => item.rank !== index + 1)) throw new Error();
  }
  for (let index = 1; index < root.recommendations.length; index++) {
    const previous = root.recommendations[index - 1] as Recommendation;
    const current = root.recommendations[index] as Recommendation;
    if (previous.sourceNodeId > current.sourceNodeId ||
        (previous.sourceNodeId === current.sourceNodeId && previous.rank >= current.rank)) throw new Error();
  }
  const ids = new Set<string>();
  for (let index = 0; index < root.alerts.length; index++) {
    const alert = root.alerts[index];
    if (!record(alert) || !exact(alert, ['actorId','evaluatedAt','anomalyScore']) ||
        typeof alert.actorId !== 'string' || !/^synthetic-test-actor-\d{3}$/.test(alert.actorId) ||
        ids.has(alert.actorId) || !validDate(alert.evaluatedAt) || !validScore(alert.anomalyScore) ||
        alert.anomalyScore < (root.threshold as number)) throw new Error();
    ids.add(alert.actorId);
    if (index > 0) {
      const previous = root.alerts[index - 1] as Alert;
      if (previous.evaluatedAt > alert.evaluatedAt ||
          (previous.evaluatedAt === alert.evaluatedAt && previous.actorId >= alert.actorId)) throw new Error();
    }
  }
  return root as unknown as Snapshot;
}
