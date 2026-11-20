import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminStatsController } from './admin-stats.controller.js';
import { MlDemoService } from './ml-demo.service.js';

const reviewer = { id: '11111111-1111-4111-8111-111111111111', email: '', role: 'ADMIN' as const, jti: '', expiresAt: '' };
const actorId = 'synthetic-test-actor-001';
const snapshotId = 'a'.repeat(64);
const snapshot = {
  schemaVersion: 1 as const, source: 'synthetic' as const, recommendationModelVersion: null, anomalyModelVersion: 'test',
  computedAt: null, recommendations: [], threshold: 0.1, evaluatedCount: 1,
  alerts: [{ actorId, evaluatedAt: '2026-01-01T00:00:00Z', anomalyScore: 0.5 }], snapshotId,
};

describe('MlDemoService', () => {
  let service: MlDemoService;
  const neo4j = { executeRead: jest.fn(), executeWrite: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    service = new MlDemoService(new ConfigService({}), neo4j as never);
    jest.spyOn(service as unknown as { loadSnapshot: () => Promise<unknown> }, 'loadSnapshot').mockResolvedValue(snapshot);
  });

  it('fails closed with a generic error when bundle is disabled or invalid', async () => {
    jest.spyOn(service as unknown as { loadSnapshot: () => Promise<unknown> }, 'loadSnapshot').mockRejectedValue({ status: 503 });
    await expect(service.recommendations(reviewer)).rejects.toMatchObject({ status: 503 });
    await expect(service.anomalies(reviewer)).rejects.toMatchObject({ status: 503 });
  });

  it('limits review reads to the requested snapshot and alert actors', async () => {
    const run = jest.fn().mockResolvedValue({ records: [{ get: (key: string) => key === 'actorId' ? actorId : '2026-01-01T00:00:00Z' }] });
    neo4j.executeRead.mockImplementation((callback) => callback({ run }));
    const result = await service.anomalies(reviewer);
    expect(run).toHaveBeenCalledWith(expect.stringContaining('review.snapshotId = $snapshotId AND review.actorId IN $actorIds'), { snapshotId, actorIds: [actorId] });
    expect(result.alerts[0]?.reviewedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('writes only with current ADMIN and verified V8 marker, returning timestamp from MERGE', async () => {
    const run = jest.fn().mockResolvedValue({ records: [{ get: () => '2026-01-02T00:00:00Z' }] });
    neo4j.executeWrite.mockImplementation((callback) => callback({ run }));
    await expect(service.review(reviewer, snapshotId, actorId)).resolves.toEqual({ snapshotId, actorId, reviewedAt: '2026-01-02T00:00:00Z' });
    const [query, params] = run.mock.calls[0];
    expect(query).toContain("ISNSchema {key: 'application', version: 8}");
    expect(query).toContain("ISNSchemaMigration {version: 8, status: 'VERIFIED'}");
    expect(query).toContain("User {id: $userId, role: 'ADMIN'}");
    expect(params.userId).toBe(reviewer.id);
  });

  it('rejects stale snapshots and unknown valid actors before persistence', async () => {
    await expect(service.review(reviewer, 'b'.repeat(64), actorId)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.review(reviewer, snapshotId, 'synthetic-test-actor-002')).rejects.toBeInstanceOf(NotFoundException);
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
  });
});

describe('AdminStatsController', () => {
  it('counts only non-deleted comments', async () => {
    const run = jest.fn().mockResolvedValue({ records: [{ get: (key: string) => key === 'comments' ? 3 : 0 }] });
    const controller = new AdminStatsController({ executeRead: (callback: (tx: { run: typeof run }) => unknown) => callback({ run }) } as never);
    await controller.stats();
    expect(run.mock.calls[0][0]).toContain('MATCH (n:Comment {deleted: false})');
  });
});
