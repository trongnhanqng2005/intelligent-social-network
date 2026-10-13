import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jMigrationService, checksumMigration, migrationDefinitions } from './neo4j-migrations.js';
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

  it('preserves the verified V1 checksum and appends Authentication as V2', () => {
    expect(migrationDefinitions.map(({ version }) => version)).toEqual([1, 2]);
    expect(checksumMigration(migrationDefinitions[0])).toBe(
      'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2',
    );
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
