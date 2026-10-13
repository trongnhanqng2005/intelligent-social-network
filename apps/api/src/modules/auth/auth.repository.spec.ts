import type { ManagedTransaction } from 'neo4j-driver';
import { AuthRepository, AccountConflictError } from './auth.repository.js';
import { Neo4jService } from '../../neo4j/neo4j.service.js';

function record(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('AuthRepository', () => {
  let neo4j: jest.Mocked<Neo4jService>;
  let run: jest.Mock;
  let repository: AuthRepository;

  beforeEach(() => {
    run = jest.fn();
    const transaction = { run } as unknown as ManagedTransaction;
    neo4j = {
      executeRead: jest.fn((work) => work(transaction)),
      executeWrite: jest.fn((work) => work(transaction)),
    } as unknown as jest.Mocked<Neo4jService>;
    repository = new AuthRepository(neo4j);
  });

  it('writes registration identity and activity event in one managed transaction', async () => {
    run.mockResolvedValue({ records: [record({ id: 'user-1', email: 'person@example.test' })] });

    await expect(repository.register({
      id: 'user-1', email: 'person@example.test', passwordHash: '$argon2id$hash',
      eventId: 'event-1', now: '2026-10-13T10:00:00.000Z',
    })).resolves.toEqual({ id: 'user-1', email: 'person@example.test' });
    expect(neo4j.executeWrite).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain("eventType: 'AUTH_REGISTERED'");
    expect(run.mock.calls[0][0]).toContain('CREATE (user)-[:PERFORMED_AUTH_EVENT]->(event)');
  });

  it('maps a unique email race to the explicit conflict type', async () => {
    run.mockRejectedValue(Object.assign(new Error('constraint'), {
      code: 'Neo.ClientError.Schema.ConstraintValidationFailed',
    }));
    await expect(repository.register({
      id: 'user-1', email: 'person@example.test', passwordHash: 'hash',
      eventId: 'event-1', now: '2026-10-13T10:00:00.000Z',
    })).rejects.toBeInstanceOf(AccountConflictError);
  });

  it('binds session restoration to user, JWT ID and exact JWT expiration', async () => {
    run.mockResolvedValue({ records: [record({
      id: 'user-1', email: 'person@example.test', expiresAt: '2026-10-14T10:00:00Z',
    })] });
    await repository.findActiveSession('user-1', 'session-jti', '2026-10-14T10:00:00.000Z');

    expect(run.mock.calls[0][0]).toContain('session.expiresAt = datetime($expectedExpiresAt)');
    expect(run.mock.calls[0][1]).toEqual({
      userId: 'user-1', jti: 'session-jti', expectedExpiresAt: '2026-10-14T10:00:00.000Z',
    });
  });

  it('creates success event/session and revocation event only for a live session', async () => {
    run.mockResolvedValue({ records: [record({ jti: 'session-jti' })] });
    await repository.createSession({
      user: { id: 'user-1', email: 'person@example.test' }, expectedPasswordHash: 'hash',
      id: 'session-1', jti: 'session-jti', eventId: 'event-login',
      now: '2026-10-13T10:00:00.000Z', expiresAt: '2026-10-14T10:00:00.000Z',
    });
    expect(run.mock.calls[0][0]).toContain("eventType: 'AUTH_LOGIN_SUCCEEDED'");
    expect(run.mock.calls[0][0]).toContain('WHERE user.passwordHash = $expectedPasswordHash');

    run.mockClear();
    run.mockResolvedValueOnce({ records: [record({ jti: 'session-jti' })] });
    await repository.revokeSession({
      userId: 'user-1', jti: 'session-jti', eventId: 'event-logout', now: '2026-10-13T10:00:00.000Z',
    });
    expect(run.mock.calls[0][0]).toContain('SET session.expiresAt = session.expiresAt');
    expect(run.mock.calls[1][0]).toContain('WHERE session.revokedAt IS NULL');
    expect(run.mock.calls[1][0]).toContain("eventType: 'AUTH_LOGOUT'");
  });
});
