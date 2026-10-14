import type { ManagedTransaction } from 'neo4j-driver';
import { int } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import { UsersRepository } from './users.repository.js';

function record(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('UsersRepository', () => {
  let run: jest.Mock;
  let repository: UsersRepository;

  beforeEach(() => {
    run = jest.fn();
    const transaction = { run } as unknown as ManagedTransaction;
    const neo4j = {
      executeRead: jest.fn((work) => work(transaction)),
      executeWrite: jest.fn((work) => work(transaction)),
    } as unknown as jest.Mocked<Neo4jService>;
    repository = new UsersRepository(neo4j);
  });

  it('returns only the explicit member-visible projection', async () => {
    run.mockResolvedValueOnce({ records: [record({
      id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'An', bio: null, location: null,
    })] });
    await expect(repository.findPublicProfile('d723b01f-7048-4efd-80c7-2d59cfb88319'))
      .resolves.toEqual({ id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'An', bio: null, location: null });
    expect(run.mock.calls[0][0]).not.toContain('passwordHash');
    expect(run.mock.calls[0][0]).not.toContain('user.email');
    expect(run.mock.calls[0][0]).not.toContain('properties(user)');
  });

  it('uses a parameterized bounded keyset query and excludes the current user', async () => {
    run.mockResolvedValueOnce({ records: [] });
    await repository.listPublicProfiles({
      userId: 'd723b01f-7048-4efd-80c7-2d59cfb88319', query: 'nguyen', afterId: 'f4ce1c82-8f40-49aa-82c8-f0515878888a', fetchLimit: 21,
    });
    const [statement, parameters] = run.mock.calls[0];
    expect(statement).toContain('user.displayNameSearch CONTAINS $query');
    expect(statement).not.toContain("$query = '' OR");
    expect(statement).not.toContain('$afterId IS NULL OR');
    expect(statement).toContain('user.id <> $userId');
    expect(statement).toContain('user.id > $afterId');
    expect(statement).toContain('ORDER BY user.id ASC LIMIT $fetchLimit');
    expect(parameters).toEqual({
      userId: 'd723b01f-7048-4efd-80c7-2d59cfb88319', query: 'nguyen',
      afterId: 'f4ce1c82-8f40-49aa-82c8-f0515878888a', fetchLimit: int(21),
    });
  });

  it('acquires a version-dependent write lock before checking and incrementing the expected version', async () => {
    run.mockResolvedValueOnce({ records: [record({
      id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'An', bio: null, location: null,
      createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:15:00.000Z', version: 1,
    })] });
    const result = await repository.updateProfile({
      userId: 'd723b01f-7048-4efd-80c7-2d59cfb88319', expectedVersion: 0,
      bio: null, updatedAt: '2026-10-14T10:15:00.000Z',
    });
    expect(result).toMatchObject({ status: 'updated', profile: { version: 1, bio: null } });
    const [statement, parameters] = run.mock.calls[0];
    expect(statement).toContain('SET user.profileVersion = user.profileVersion + 0');
    expect(statement).toContain('WHERE currentVersion = $expectedVersion');
    expect(statement).toContain('user.profileVersion = currentVersion + 1');
    expect(parameters).toMatchObject({ changeDisplayName: false, changeBio: true, bio: null, changeLocation: false });
  });

  it('distinguishes a stale version from a missing user without retrying the update', async () => {
    run.mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [record({ id: 'existing' })] });
    await expect(repository.updateProfile({
      userId: 'd723b01f-7048-4efd-80c7-2d59cfb88319', expectedVersion: 4,
      displayName: 'New name', updatedAt: '2026-10-14T10:15:00.000Z',
    })).resolves.toEqual({ status: 'conflict' });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
