import type { ManagedTransaction } from 'neo4j-driver';
import {
  Neo4jMigrationService,
  checksumMigration,
  isProfileVerificationValid,
  isProfileUserIdPreflightValid,
  migrationDefinitions,
  profileUserIdPreflight,
} from './neo4j-migrations.js';
import { Neo4jService } from './neo4j.service.js';

function record(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

describe('Neo4jMigrationService', () => {
  let neo4j: jest.Mocked<Neo4jService>;
  let transaction: jest.Mocked<ManagedTransaction>;
  let service: Neo4jMigrationService;

  beforeEach(() => {
    transaction = {
      run: jest.fn()
        .mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] })
        .mockResolvedValueOnce({ records: [record({ version: 1 })] })
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] }),
    } as unknown as jest.Mocked<ManagedTransaction>;
    neo4j = {
      database: 'isn-test',
      verifyConnectivity: jest.fn().mockResolvedValue(undefined),
      executeRead: jest.fn(async (work) => work(transaction)),
      executeWrite: jest.fn(async (work) => work(transaction)),
      runSchemaStatement: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Neo4jService>;
    service = new Neo4jMigrationService(neo4j);
  });

  it('uses a stable content checksum that changes when the migration definition changes', () => {
    expect(checksumMigration({ version: 1, name: 'foundation', statements: ['RETURN 1'] }))
      .toMatch(/^[a-f0-9]{64}$/);
    expect(checksumMigration({ version: 1, name: 'foundation', statements: ['RETURN 1'] }))
      .toBe(checksumMigration({ version: 1, name: 'foundation', statements: ['RETURN 1'] }));
    expect(checksumMigration({ version: 1, name: 'foundation', statements: ['RETURN 2'] }))
      .not.toBe(checksumMigration({ version: 1, name: 'foundation', statements: ['RETURN 1'] }));
  });

  it('preserves V1–V3 checksums and appends friendship migration as V4', () => {
    expect(migrationDefinitions.map(({ version }) => version)).toEqual([1, 2, 3, 4]);
    expect(checksumMigration(migrationDefinitions[0])).toBe(
      'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2',
    );
    expect(checksumMigration(migrationDefinitions[1])).toBe(
      'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de',
    );
    expect(checksumMigration(migrationDefinitions[2])).toBe(
      'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee',
    );
    expect(migrationDefinitions[3].name).toBe('friendship-system');
    expect(migrationDefinitions[3].statements).toHaveLength(6);
    expect(migrationDefinitions[3].statements[0]).toContain('isn_friendship_pair_key');
    expect(migrationDefinitions[3].statements[2]).toContain('FRIEND_WITH');
    expect(migrationDefinitions[3].preflight).toContain('FriendshipPair');
    expect(checksumMigration({
      ...migrationDefinitions[2],
      dataStatements: ['RETURN 1'],
    })).not.toBe(checksumMigration(migrationDefinitions[2]));
  });

  it('fails closed when profile verification returns no, invalid or duplicate results', () => {
    expect(isProfileVerificationValid([])).toBe(false);
    expect(isProfileVerificationValid([{ get: () => 0 }])).toBe(true);
    expect(isProfileVerificationValid([{ get: () => 1 }])).toBe(false);
    expect(isProfileVerificationValid([{ get: () => 0 }, { get: () => 0 }])).toBe(false);
    for (const invalid of [undefined, null, '0', {}]) {
      expect(isProfileVerificationValid([{ get: () => invalid }])).toBe(false);
    }
  });

  it('fails closed for missing or invalid User ID preflight results', () => {
    expect(isProfileUserIdPreflightValid([])).toBe(false);
    expect(isProfileUserIdPreflightValid([{ get: () => 0 }])).toBe(true);
    expect(isProfileUserIdPreflightValid([{ get: () => 1 }])).toBe(false);
    expect(isProfileUserIdPreflightValid([{ get: () => 0 }, { get: () => 0 }])).toBe(false);
    for (const invalid of [undefined, null, '0', {}]) {
      expect(isProfileUserIdPreflightValid([{ get: () => invalid }])).toBe(false);
    }
  });

  it('rejects a non-UUID User ID before recording V3 as APPLYING', async () => {
    let insideWrite = false;
    const writes: Array<{ query: string; parameters?: Record<string, unknown> }> = [];
    transaction.run.mockReset();
    const run = transaction.run as unknown as jest.Mock;
    run.mockImplementation(async (query: unknown, parameters?: Record<string, unknown>) => {
      const queryText = String(query);
      if (insideWrite) writes.push({ query: queryText, parameters });
      if (queryText.includes('CALL db.info()')) return { records: [record({ database: 'isn-test' })] };
      if (queryText === migrationDefinitions[2].preflight) return { records: [record({ conflicts: 0 })] };
      if (queryText === profileUserIdPreflight) return { records: [record({ invalidUserIds: 1 })] };
      return { records: [] };
    });
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    neo4j.executeWrite.mockImplementation(async (work) => {
      insideWrite = true;
      try {
        return await work(transaction);
      } finally {
        insideWrite = false;
      }
    });
    jest.spyOn(service, 'getStatus').mockResolvedValue({
      database: 'isn-test', status: 'empty', version: 0, migrations: [],
    });
    const internals = service as unknown as {
      ensureConstraint: jest.Mock;
      findHistory: jest.Mock;
      inspect: jest.Mock;
    };
    internals.ensureConstraint = jest.fn().mockResolvedValue(undefined);
    internals.findHistory = jest.fn().mockResolvedValue(undefined);
    internals.inspect = jest.fn().mockResolvedValue({
      database: 'isn-test', markerVersion: 0, history: [], schemaValid: true,
    });

    await expect(service.migrate()).rejects.toThrow(/every existing User ID to be a UUID/u);
    expect(transaction.run).toHaveBeenCalledWith(profileUserIdPreflight);
    expect(writes.some(({ parameters }) => parameters?.version === 3)).toBe(false);
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalledWith(migrationDefinitions[2].statements[0]);
  });

  it('fails closed before V4 writes when friendship data already exists', async () => {
    transaction.run.mockReset();
    const run = transaction.run as unknown as jest.Mock;
    run.mockImplementation(async (query: unknown) => {
      const queryText = String(query);
      if (queryText.includes('CALL db.info()')) return { records: [record({ database: 'isn-test' })] };
      if (queryText === migrationDefinitions[3].preflight) return { records: [record({ conflicts: 1 })] };
      return { records: [] };
    });
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    jest.spyOn(service, 'getStatus').mockResolvedValue({
      database: 'isn-test', status: 'incomplete', version: 3,
      migrations: migrationDefinitions.slice(0, 3).map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: checksumMigration(migration),
        status: 'VERIFIED',
        appliedAt: 'now',
        verifiedAt: 'now',
      })),
    });
    const internals = service as unknown as {
      ensureConstraint: jest.Mock;
      findHistory: jest.Mock;
      preflightFriendshipSchema: jest.Mock;
    };
    internals.ensureConstraint = jest.fn().mockResolvedValue(undefined);
    internals.findHistory = jest.fn(async (version: number) => version < 4
      ? { version, name: migrationDefinitions[version - 1]!.name,
          checksum: checksumMigration(migrationDefinitions[version - 1]!), status: 'VERIFIED',
          appliedAt: 'now', verifiedAt: 'now' }
      : undefined);
    internals.preflightFriendshipSchema = jest.fn();

    await expect(service.migrate()).rejects.toThrow(/existing friendship data.*no V4 writes/u);
    expect(internals.preflightFriendshipSchema).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
  });

  it('stops before writes when a previous V4 apply is interrupted', async () => {
    transaction.run.mockReset().mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never);
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    jest.spyOn(service, 'getStatus').mockResolvedValue({
      database: 'isn-test', status: 'incomplete', version: 4,
      migrations: [{
        version: 4,
        name: 'friendship-system',
        checksum: checksumMigration(migrationDefinitions[3]),
        status: 'APPLYING',
        appliedAt: 'now',
        verifiedAt: null,
      }],
    });
    const internals = service as unknown as { ensureConstraint: jest.Mock };
    internals.ensureConstraint = jest.fn();

    await expect(service.migrate()).rejects.toThrow(/interrupted V4 migration.*no migration writes/u);
    expect(internals.ensureConstraint).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
  });

  it('fails V4 preflight when any Friendship schema object already exists without verified V4 history', async () => {
    transaction.run.mockReset()
      .mockResolvedValueOnce({ records: [record({
        name: 'unexpected_friendship_pair_index', labelsOrTypes: ['FriendshipPair'],
      })] } as never)
      .mockResolvedValueOnce({ records: [] } as never);
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    const internals = service as unknown as { preflightFriendshipSchema: () => Promise<void> };

    await expect(internals.preflightFriendshipSchema()).rejects.toThrow(/Unexpected Friendship schema objects/u);
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
  });

  it('reports checksum drift for an already recorded migration', async () => {
    transaction.run.mockReset();
    transaction.run
      .mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never)
      .mockResolvedValueOnce({ records: [record({ version: 1 })] } as never)
      .mockResolvedValueOnce({ records: [record({ version: 1, checksum: 'wrong', status: 'VERIFIED' })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [] } as never);

    await expect(service.getStatus()).resolves.toMatchObject({
      database: 'isn-test',
      status: 'drift',
      version: 1,
    });
  });

  it('refuses migration writes when applied checksum drift is already present', async () => {
    transaction.run.mockReset();
    transaction.run
      .mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never)
      .mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [record({ version: 1, checksum: 'changed', status: 'VERIFIED' })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [] } as never);

    await expect(service.migrate()).rejects.toThrow(/drift detected; no migration was applied/);
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
  });

  it('reports an interrupted APPLYING record without treating it as verified', async () => {
    const checksum = checksumMigration({
      version: 1,
      name: 'foundation-schema-marker',
      statements: [
        `CREATE CONSTRAINT isn_schema_metadata_key IF NOT EXISTS
       FOR (schema:ISNSchema) REQUIRE schema.key IS UNIQUE`,
        `CREATE CONSTRAINT isn_schema_migration_version IF NOT EXISTS
       FOR (migration:ISNSchemaMigration) REQUIRE migration.version IS UNIQUE`,
      ],
    });
    transaction.run.mockReset();
    transaction.run
      .mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [record({ version: 1, name: 'foundation-schema-marker', checksum, status: 'APPLYING' })] } as never)
      .mockResolvedValueOnce({ records: [] } as never)
      .mockResolvedValueOnce({ records: [] } as never);

    await expect(service.getStatus()).resolves.toMatchObject({ status: 'incomplete' });
  });
});
