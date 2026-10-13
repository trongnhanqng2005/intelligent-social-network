import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from './neo4j.service.js';

const migrationDefinitions = [
  {
    version: 1,
    name: 'foundation-schema-marker',
    statements: [
      `CREATE CONSTRAINT isn_schema_metadata_key IF NOT EXISTS
       FOR (schema:ISNSchema) REQUIRE schema.key IS UNIQUE`,
      `CREATE CONSTRAINT isn_schema_migration_version IF NOT EXISTS
       FOR (migration:ISNSchemaMigration) REQUIRE migration.version IS UNIQUE`,
    ],
  },
] as const;

const requiredConstraints = [
  {
    name: 'isn_schema_metadata_key',
    type: 'NODE_PROPERTY_UNIQUENESS',
    entityType: 'NODE',
    labelsOrTypes: ['ISNSchema'],
    properties: ['key'],
  },
  {
    name: 'isn_schema_migration_version',
    type: 'NODE_PROPERTY_UNIQUENESS',
    entityType: 'NODE',
    labelsOrTypes: ['ISNSchemaMigration'],
    properties: ['version'],
  },
] as const;

export type MigrationStatus = {
  database: string;
  status: 'empty' | 'current' | 'incomplete' | 'drift' | 'database-mismatch';
  version: number;
  migrations: Array<{
    version: number;
    name: string;
    checksum: string;
    status: string;
    appliedAt: string | null;
    verifiedAt: string | null;
  }>;
};

export function checksumMigration(migration: {
  version: number;
  name: string;
  statements: readonly string[];
}): string {
  return createHash('sha256')
    .update(JSON.stringify(migration))
    .digest('hex');
}

@Injectable()
export class Neo4jMigrationService {
  constructor(private readonly neo4jService: Neo4jService) {}

  async getStatus(): Promise<MigrationStatus> {
    const inspection = await this.neo4jService.executeRead((transaction) =>
      this.inspect(transaction),
    );
    if (inspection.database !== this.neo4jService.database) {
      return this.toStatus('database-mismatch', inspection.history);
    }

    const drift = inspection.history.some((record) => {
      const definition = migrationDefinitions.find((item) => item.version === record.version);
      return !definition || record.checksum !== checksumMigration(definition);
    });
    if (drift) return this.toStatus('drift', inspection.history);

    const pending = inspection.history.some((record) =>
      record.status !== 'VERIFIED' || !record.appliedAt || !record.verifiedAt,
    );
    const current = migrationDefinitions.every((definition) =>
      inspection.history.some((record) =>
        record.version === definition.version &&
        record.status === 'VERIFIED' &&
        record.checksum === checksumMigration(definition),
      ),
    ) && inspection.constraintsValid && inspection.markerVersion === migrationDefinitions.at(-1)?.version;

    const resultStatus = current
      ? 'current'
      : pending
        ? 'incomplete'
        : inspection.history.length === 0
          ? 'empty'
          : 'drift';
    return this.toStatus(resultStatus, inspection.history);
  }

  async migrate(): Promise<MigrationStatus> {
    await this.neo4jService.verifyConnectivity();
    const database = await this.neo4jService.executeRead(async (transaction) => {
      const result = await transaction.run('CALL db.info() YIELD name RETURN name AS database');
      return result.records[0]?.get('database');
    });
    if (database !== this.neo4jService.database) {
      throw new Error(`Migration target identity mismatch; expected ${this.neo4jService.database}`);
    }

    const priorStatus = await this.getStatus();
    if (priorStatus.status === 'database-mismatch') {
      throw new Error('Migration target identity mismatch during history inspection');
    }
    if (priorStatus.status === 'drift') {
      throw new Error('Existing migration checksum or schema definition drift detected; no migration was applied');
    }
    if (priorStatus.status === 'current') return priorStatus;

    for (const constraint of requiredConstraints) {
      await this.ensureConstraint(constraint);
    }

    for (const migration of migrationDefinitions) {
      const checksum = checksumMigration(migration);
      const existing = await this.findHistory(migration.version);
      if (existing && existing.checksum !== checksum) {
        throw new Error(`Migration V${migration.version} checksum drift detected; do not edit applied migrations`);
      }
      if (existing?.status === 'VERIFIED') continue;

      await this.neo4jService.executeWrite((transaction) => transaction.run(
        `MERGE (migration:ISNSchemaMigration {version: $version})
         ON CREATE SET migration.name = $name,
                       migration.checksum = $checksum,
                       migration.status = 'APPLYING',
                       migration.appliedAt = datetime()`,
        { version: migration.version, name: migration.name, checksum },
      ).then(() => undefined));

      try {
        for (const statement of migration.statements) {
          await this.neo4jService.runSchemaStatement(statement);
        }
        await this.neo4jService.executeWrite((transaction) => transaction.run(
          `MERGE (schema:ISNSchema {key: $key})
           SET schema.version = $version`,
          { key: 'application', version: migration.version },
        ).then(() => undefined));

        const inspection = await this.neo4jService.executeRead((transaction) =>
          this.inspect(transaction),
        );
        if (inspection.database !== this.neo4jService.database || !inspection.constraintsValid) {
          throw new Error('Post-migration schema verification failed');
        }
        await this.neo4jService.executeWrite((transaction) => transaction.run(
          `MATCH (migration:ISNSchemaMigration {version: $version})
           SET migration.status = 'VERIFIED', migration.verifiedAt = datetime()`,
          { version: migration.version },
        ).then(() => undefined));
      } catch {
        throw new Error(
          `Migration V${migration.version} did not complete. Its history remains APPLYING when recorded; inspect schema/history and rerun only after resolving the reported partial state. No automatic rollback is attempted.`,
        );
      }
    }
    const finalStatus = await this.getStatus();
    if (finalStatus.status !== 'current') {
      throw new Error(`Migration verification ended in state ${finalStatus.status}`);
    }
    return finalStatus;
  }

  private async ensureConstraint(
    expected: (typeof requiredConstraints)[number],
  ): Promise<void> {
    const current = await this.readConstraint(expected.name);
    if (current && !matchesConstraint(current, expected)) {
      throw new Error(`Constraint ${expected.name} exists with a different definition; manual review required`);
    }
    if (!current) {
      const migrationStatement = expected.name === 'isn_schema_metadata_key'
        ? migrationDefinitions[0].statements[0]
        : migrationDefinitions[0].statements[1];
      await this.neo4jService.runSchemaStatement(migrationStatement);
    }
    const verified = await this.readConstraint(expected.name);
    if (!verified || !matchesConstraint(verified, expected)) {
      throw new Error(`Constraint ${expected.name} could not be verified; inspect database schema before retrying`);
    }
  }

  private async readConstraint(name: string): Promise<Record<string, unknown> | undefined> {
    return this.neo4jService.executeRead(async (transaction) => {
      const result = await transaction.run(
        `SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties
         RETURN name, type, entityType, labelsOrTypes, properties`,
      );
      const record = result.records.find((item) => item.get('name') === name);
      if (!record) return undefined;
      return Object.fromEntries(
        ['name', 'type', 'entityType', 'labelsOrTypes', 'properties'].map((key) => [key, record.get(key)]),
      );
    });
  }

  private async findHistory(version: number): Promise<HistoryRecord | undefined> {
    return this.neo4jService.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (migration:ISNSchemaMigration {version: $version})
         RETURN migration.version AS version, migration.name AS name,
                migration.checksum AS checksum, migration.status AS status,
                toString(migration.appliedAt) AS appliedAt,
                toString(migration.verifiedAt) AS verifiedAt`,
        { version },
      );
      const record = result.records[0];
      if (!record) return undefined;
      return {
        version: asNumber(record.get('version')),
        name: String(record.get('name') ?? ''),
        checksum: String(record.get('checksum') ?? ''),
        status: String(record.get('status') ?? ''),
        appliedAt: typeof record.get('appliedAt') === 'string' ? record.get('appliedAt') as string : null,
        verifiedAt: typeof record.get('verifiedAt') === 'string' ? record.get('verifiedAt') as string : null,
      };
    });
  }

  private async inspect(transaction: ManagedTransaction) {
    const identity = await transaction.run('CALL db.info() YIELD name RETURN name AS database');
    const marker = await transaction.run(
      `MATCH (schema:ISNSchema {key: 'application'}) RETURN schema.version AS version LIMIT 1`,
    );
    const history = await transaction.run(
      `MATCH (migration:ISNSchemaMigration)
       RETURN migration.version AS version, migration.name AS name,
              migration.checksum AS checksum, migration.status AS status,
              toString(migration.appliedAt) AS appliedAt,
              toString(migration.verifiedAt) AS verifiedAt ORDER BY version`,
    );
    const constraints = await transaction.run(
      'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
    );
    const constraintRows = constraints.records.map((record) => Object.fromEntries(
      ['name', 'type', 'entityType', 'labelsOrTypes', 'properties'].map((key) => [key, record.get(key)]),
    ));
    const historyRecords = history.records.map((record) => ({
      version: asNumber(record.get('version')),
      name: String(record.get('name') ?? ''),
      checksum: String(record.get('checksum') ?? ''),
      status: String(record.get('status') ?? ''),
      appliedAt: typeof record.get('appliedAt') === 'string' ? record.get('appliedAt') as string : null,
      verifiedAt: typeof record.get('verifiedAt') === 'string' ? record.get('verifiedAt') as string : null,
    }));
    return {
      database: identity.records[0]?.get('database'),
      markerVersion: asNumber(marker.records[0]?.get('version')),
      history: historyRecords,
      constraintsValid: requiredConstraints.every((expected) => {
        const actual = constraintRows.find((constraint) => constraint.name === expected.name);
        return actual !== undefined && matchesConstraint(actual, expected);
      }),
    };
  }

  private toStatus(status: MigrationStatus['status'], history: HistoryRecord[]): MigrationStatus {
    return {
      database: this.neo4jService.database,
      status,
      version: history.reduce((highest, record) => Math.max(highest, record.version), 0),
      migrations: history.map((record) => ({ ...record })),
    };
  }
}

interface HistoryRecord {
  version: number;
  name: string;
  checksum: string;
  status: string;
  appliedAt: string | null;
  verifiedAt: string | null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return 0;
}

function matchesConstraint(actual: Record<string, unknown>, expected: (typeof requiredConstraints)[number]): boolean {
  return actual.type === expected.type &&
    actual.entityType === expected.entityType &&
    sameList(actual.labelsOrTypes, expected.labelsOrTypes) &&
    sameList(actual.properties, expected.properties);
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value);
}
