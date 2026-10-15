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

  it('preserves V1–V4 checksums and appends Posts migration as V5', () => {
    expect(migrationDefinitions.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5]);
    expect(checksumMigration(migrationDefinitions[0])).toBe(
      'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2',
    );
    expect(checksumMigration(migrationDefinitions[1])).toBe(
      'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de',
    );
    expect(checksumMigration(migrationDefinitions[2])).toBe(
      'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee',
    );
    expect(checksumMigration(migrationDefinitions[3])).toBe(
      '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2',
    );
    expect(checksumMigration(migrationDefinitions[4])).toBe(
      '48613d31278476128f0d904ad40c76c21c68d61d20b2b3fa526f423de63be523',
    );
    expect(migrationDefinitions[3].name).toBe('friendship-system');
    expect(migrationDefinitions[3].statements).toHaveLength(6);
    expect(migrationDefinitions[3].statements[0]).toContain('isn_friendship_pair_key');
    expect(migrationDefinitions[3].statements[2]).toContain('FRIEND_WITH');
    expect(migrationDefinitions[3].preflight).toContain('FriendshipPair');
    expect(migrationDefinitions[4].name).toBe('posts-feed');
    expect(migrationDefinitions[4].statements).toHaveLength(2);
    expect(migrationDefinitions[4].statements[0]).toContain('isn_post_id');
    expect(migrationDefinitions[4].statements[1]).toContain('isn_post_author_chronology');
    expect(migrationDefinitions[4].preflight).toContain('AUTHORED');
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

  it('fails closed before V5 writes when Post data already exists', async () => {
    transaction.run.mockReset();
    const run = transaction.run as unknown as jest.Mock;
    run.mockImplementation(async (query: unknown) => {
      const queryText = String(query);
      if (queryText.includes('CALL db.info()')) return { records: [record({ database: 'isn-test' })] };
      if (queryText === migrationDefinitions[4].preflight) return { records: [record({ conflicts: 1 })] };
      return { records: [] };
    });
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    jest.spyOn(service, 'getStatus').mockResolvedValue({
      database: 'isn-test', status: 'incomplete', version: 4,
      migrations: migrationDefinitions.slice(0, 4).map((migration) => ({
        version: migration.version, name: migration.name, checksum: checksumMigration(migration),
        status: 'VERIFIED', appliedAt: 'now', verifiedAt: 'now',
      })),
    });
    const internals = service as unknown as {
      ensureConstraint: jest.Mock;
      findHistory: jest.Mock;
      inspect: jest.Mock;
    };
    internals.ensureConstraint = jest.fn().mockResolvedValue(undefined);
    internals.inspect = jest.fn().mockResolvedValue({
      database: 'isn-test', markerVersion: 4,
      history: migrationDefinitions.slice(0, 4).map((migration) => ({
        version: migration.version, name: migration.name, checksum: checksumMigration(migration),
        status: 'VERIFIED', appliedAt: 'now', verifiedAt: 'now',
      })),
      schemaValid: true,
    });
    internals.findHistory = jest.fn(async (version: number) => version < 5
      ? { version, name: migrationDefinitions[version - 1]!.name,
          checksum: checksumMigration(migrationDefinitions[version - 1]!), status: 'VERIFIED',
          appliedAt: 'now', verifiedAt: 'now' }
      : undefined);

    await expect(service.migrate()).rejects.toThrow(/existing Post data.*no V5 writes/u);
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
  });

  it('fails V5 preflight when a Post schema object exists without verified V5 history', async () => {
    transaction.run.mockReset()
      .mockResolvedValueOnce({ records: [record({ name: 'unexpected_post_index', labelsOrTypes: ['Post'] })] } as never)
      .mockResolvedValueOnce({ records: [] } as never);
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    const internals = service as unknown as { preflightPostSchema: () => Promise<void> };

    await expect(internals.preflightPostSchema()).rejects.toThrow(/Unexpected Posts schema objects/u);
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
  });

  it('requires exact verified V1–V4 history and catalog before V5 can proceed', async () => {
    const history = migrationDefinitions.slice(0, 4).map((migration) => ({
      version: migration.version,
      name: migration.name,
      checksum: checksumMigration(migration),
      status: 'VERIFIED',
      appliedAt: 'now',
      verifiedAt: 'now',
    }));
    const internals = service as unknown as {
      inspect: jest.Mock;
      assertVerifiedV4Baseline: () => Promise<void>;
    };
    internals.inspect = jest.fn().mockResolvedValue({
      database: 'isn-test', markerVersion: 4, history, schemaValid: true,
    });
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));

    await expect(internals.assertVerifiedV4Baseline()).resolves.toBeUndefined();
    internals.inspect.mockResolvedValueOnce({
      database: 'isn-test', markerVersion: 4, history, schemaValid: false,
    });
    await expect(internals.assertVerifiedV4Baseline()).rejects.toThrow(/verified V1–V4 schema baseline/u);
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
  });

  it('stops before writes when a previous V5 apply is interrupted', async () => {
    transaction.run.mockReset().mockResolvedValueOnce({ records: [record({ database: 'isn-test' })] } as never);
    neo4j.executeRead.mockImplementation(async (work) => work(transaction));
    jest.spyOn(service, 'getStatus').mockResolvedValue({
      database: 'isn-test', status: 'incomplete', version: 5,
      migrations: [{
        version: 5, name: 'posts-feed', checksum: checksumMigration(migrationDefinitions[4]),
        status: 'APPLYING', appliedAt: 'now', verifiedAt: null,
      }],
    });
    const internals = service as unknown as { ensureConstraint: jest.Mock };
    internals.ensureConstraint = jest.fn();

    await expect(service.migrate()).rejects.toThrow(/interrupted V5 migration.*no migration writes/u);
    expect(internals.ensureConstraint).not.toHaveBeenCalled();
    expect(neo4j.runSchemaStatement).not.toHaveBeenCalled();
    expect(neo4j.executeWrite).not.toHaveBeenCalled();
  });

  it('reports current only when verified V1–V5 history and the complete ONLINE catalog match', async () => {
    const constraints = [
      ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['ISNSchema'], ['key']],
      ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['ISNSchemaMigration'], ['version']],
      ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['User'], ['id']],
      ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['User'], ['email']],
      ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthSession'], ['id']],
      ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthSession'], ['jti']],
      ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['AuthActivityEvent'], ['eventId']],
      ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['FriendshipPair'], ['pairKey']],
      ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['FriendshipPair'], ['requestId']],
      ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', ['FRIEND_WITH'], ['id']],
      ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', ['FRIEND_WITH'], ['pairKey']],
      ['isn_post_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', ['Post'], ['id']],
    ].map(([name, type, entityType, labelsOrTypes, properties]) => record({
      name, type, entityType, labelsOrTypes, properties,
    }));
    let postIndexState = 'ONLINE';
    const indexes = [
      ['isn_auth_session_expires_at', 'RANGE', ['AuthSession'], ['expiresAt']],
      ['isn_auth_event_timestamp', 'RANGE', ['AuthActivityEvent'], ['timestamp']],
      ['isn_user_display_name_search', 'TEXT', ['User'], ['displayNameSearch']],
      ['isn_friendship_requests_sent', 'RANGE', ['FriendshipPair'], ['senderId', 'requestStatus', 'requestId']],
      ['isn_friendship_requests_received', 'RANGE', ['FriendshipPair'], ['recipientId', 'requestStatus', 'requestId']],
      ['isn_post_author_chronology', 'RANGE', ['Post'], ['authorId', 'createdAt', 'id']],
    ].map(([name, type, labelsOrTypes, properties]) => record({
      name, type, entityType: 'NODE', labelsOrTypes, properties,
      state: 'ONLINE',
    }));
    const chronologyValues = {
      name: 'isn_post_author_chronology', type: 'RANGE', entityType: 'NODE',
      labelsOrTypes: ['Post'], properties: ['authorId', 'createdAt', 'id'],
    };
    const chronologyIndex = { get: (key: string) => key === 'state' ? postIndexState : chronologyValues[key as keyof typeof chronologyValues] };
    indexes[indexes.length - 1] = chronologyIndex;
    const run = transaction.run as unknown as jest.Mock;
    run.mockReset().mockImplementation(async (query: unknown) => {
      const queryText = String(query);
      if (queryText.includes('CALL db.info()')) return { records: [record({ database: 'isn-test' })] };
      if (queryText.includes("MATCH (schema:ISNSchema")) return { records: [record({ version: 5 })] };
      if (queryText.includes('MATCH (migration:ISNSchemaMigration')) {
        return { records: migrationDefinitions.map((migration) => record({
          version: migration.version, name: migration.name, checksum: checksumMigration(migration),
          status: 'VERIFIED', appliedAt: 'now', verifiedAt: 'now',
        })) };
      }
      if (queryText.includes('SHOW CONSTRAINTS')) return { records: constraints };
      if (queryText.includes('SHOW INDEXES')) return { records: indexes };
      if (queryText === migrationDefinitions[2].verification) return { records: [record({ invalidProfiles: 0 })] };
      return { records: [] };
    });

    await expect(service.getStatus()).resolves.toMatchObject({ database: 'isn-test', status: 'current', version: 5 });
    postIndexState = 'POPULATING';
    await expect(service.getStatus()).resolves.toMatchObject({ database: 'isn-test', status: 'drift', version: 5 });
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
