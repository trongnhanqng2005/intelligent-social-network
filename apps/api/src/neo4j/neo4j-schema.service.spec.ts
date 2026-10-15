import { APPLICATION_SCHEMA_VERSION } from './neo4j.constants.js';
import { Neo4jMigrationService } from './neo4j-migrations.js';
import { Neo4jSchemaService } from './neo4j-schema.service.js';
import { Neo4jService } from './neo4j.service.js';

describe('Neo4jSchemaService', () => {
  let neo4j: jest.Mocked<Neo4jService>;
  let migrations: jest.Mocked<Neo4jMigrationService>;
  let service: Neo4jSchemaService;

  beforeEach(() => {
    neo4j = {
      database: 'isn-dev',
      verifyConnectivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Neo4jService>;
    migrations = {
      getStatus: jest.fn().mockResolvedValue({ database: 'isn-dev', status: 'current', version: APPLICATION_SCHEMA_VERSION, migrations: [] }),
      migrate: jest.fn().mockResolvedValue({ database: 'isn-dev', status: 'current', version: APPLICATION_SCHEMA_VERSION, migrations: [] }),
    } as unknown as jest.Mocked<Neo4jMigrationService>;
    service = new Neo4jSchemaService(neo4j, migrations);
  });

  it('reports ready only for the verified migration history', async () => {
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready', database: 'isn-dev', schemaVersion: APPLICATION_SCHEMA_VERSION,
    });
  });

  it('does not report a V4 database ready for the V5 Posts implementation', async () => {
    migrations.getStatus.mockResolvedValueOnce({
      database: 'isn-dev', status: 'incomplete', version: 4, migrations: [],
    });
    await expect(service.checkReadiness()).resolves.toMatchObject({
      status: 'not_ready', reason: 'SCHEMA_MIGRATION_INCOMPLETE',
      expectedSchemaVersion: 5, actualSchemaVersion: 4,
    });
  });

  it('sanitizes unavailable database and schema inspection errors', async () => {
    neo4j.verifyConnectivity.mockRejectedValueOnce(new Error('private connection detail'));
    await expect(service.checkReadiness()).resolves.toMatchObject({ reason: 'DATABASE_UNAVAILABLE' });
    migrations.getStatus.mockRejectedValueOnce(new Error('private query detail'));
    await expect(service.checkReadiness()).resolves.toMatchObject({ reason: 'SCHEMA_INSPECTION_FAILED' });
  });

  it.each([
    ['empty', 'SCHEMA_UNINITIALIZED'],
    ['incomplete', 'SCHEMA_MIGRATION_INCOMPLETE'],
    ['drift', 'SCHEMA_DRIFT'],
    ['database-mismatch', 'DATABASE_IDENTITY_MISMATCH'],
  ] as const)('maps migration status %s to readiness reason %s', async (status, reason) => {
    migrations.getStatus.mockResolvedValueOnce({ database: 'isn-dev', status, version: 0, migrations: [] });
    await expect(service.checkReadiness()).resolves.toMatchObject({ reason });
  });

  it('runs the explicit migration service through the existing initializer API', async () => {
    await expect(service.initializeSchema()).resolves.toMatchObject({ status: 'ready', database: 'isn-dev' });
    expect(migrations.migrate).toHaveBeenCalledTimes(1);
  });
});
