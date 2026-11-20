import type { ManagedTransaction } from 'neo4j-driver';
import type { Neo4jService } from '../../neo4j/neo4j.service.js';
import { AdminRepository } from './admin.repository.js';

function record(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('AdminRepository', () => {
  it('aggregates 1h/24h Neo4j windows and deduplicates distinct non-self targets', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const targetA = '22222222-2222-4222-8222-222222222222';
    const targetB = '33333333-3333-4333-8333-333333333333';

    const transaction = {
      run: jest.fn().mockResolvedValue({
        records: [record({
          userId,
          email: 'an@example.test',
          displayName: 'Nguyễn An',
          auth1h: 3,
          auth24h: 4,
          failedLogin1h: 2,
          failedLogin24h: 2,
          friendReq1h: 1,
          friendReq24h: 2,
          post1h: 1,
          post24h: 1,
          comment1h: 2,
          comment24h: 3,
          freqTargets1h: [targetA, null],
          freqTargets24h: [targetA, targetB],
          commentTargets1h: [userId, targetA, targetB],
          commentTargets24h: [userId, targetB],
          lastAuthAt: '2026-11-20T01:05:00.000Z',
          lastFriendReqAt: '2026-11-20T01:10:00.000Z',
          lastPostAt: null,
          lastCommentAt: '2026-11-19T22:00:00.000Z',
        })],
      }),
    } as unknown as jest.Mocked<ManagedTransaction>;

    const neo4j = {
      executeRead: jest.fn(async (work) => work(transaction)),
    } as unknown as jest.Mocked<Neo4jService>;

    const repository = new AdminRepository(neo4j);
    const windows = await repository.listUserActivityWindows('2026-11-20T01:15:00.000Z');

    expect(windows).toEqual([{
      userId,
      email: 'an@example.test',
      displayName: 'Nguyễn An',
      auth1h: 3,
      auth24h: 4,
      failedLogin1h: 2,
      failedLogin24h: 2,
      friendReq1h: 1,
      friendReq24h: 2,
      post1h: 1,
      post24h: 1,
      comment1h: 2,
      comment24h: 3,
      distinctTargets1h: 2,
      distinctTargets24h: 2,
      lastActivityAt: '2026-11-20T01:10:00.000Z',
    }]);
  });
});
