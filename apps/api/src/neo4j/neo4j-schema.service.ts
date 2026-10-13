import { Injectable } from '@nestjs/common';
import { FOUNDATION_SCHEMA_VERSION } from './neo4j.constants.js';
import { Neo4jMigrationService } from './neo4j-migrations.js';
import type { MigrationStatus } from './neo4j-migrations.js';
import { Neo4jService } from './neo4j.service.js';

export type ReadinessReason =
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_IDENTITY_MISMATCH'
  | 'SCHEMA_INSPECTION_FAILED'
  | 'SCHEMA_UNINITIALIZED'
  | 'SCHEMA_DRIFT'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'SCHEMA_MIGRATION_INCOMPLETE';

export type ReadinessResult =
  | { status: 'ready'; database: string; schemaVersion: number }
  | {
      status: 'not_ready';
      database: string;
      reason: ReadinessReason;
      expectedSchemaVersion?: number;
      actualSchemaVersion?: number;
    };

@Injectable()
export class Neo4jSchemaService {
  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly migrations: Neo4jMigrationService,
  ) {}

  async checkReadiness(): Promise<ReadinessResult> {
    try {
      await this.neo4jService.verifyConnectivity();
    } catch {
      return { status: 'not_ready', database: this.neo4jService.database, reason: 'DATABASE_UNAVAILABLE' };
    }

    let migrationStatus: MigrationStatus;
    try {
      migrationStatus = await this.migrations.getStatus();
    } catch {
      return { status: 'not_ready', database: this.neo4jService.database, reason: 'SCHEMA_INSPECTION_FAILED' };
    }
    if (migrationStatus.status === 'database-mismatch') {
      return { status: 'not_ready', database: this.neo4jService.database, reason: 'DATABASE_IDENTITY_MISMATCH' };
    }
    if (migrationStatus.status === 'drift') {
      return {
        status: 'not_ready', database: this.neo4jService.database,
        reason: 'SCHEMA_DRIFT', expectedSchemaVersion: FOUNDATION_SCHEMA_VERSION,
        actualSchemaVersion: migrationStatus.version,
      };
    }
    if (migrationStatus.status === 'incomplete') {
      return {
        status: 'not_ready', database: this.neo4jService.database,
        reason: 'SCHEMA_MIGRATION_INCOMPLETE', expectedSchemaVersion: FOUNDATION_SCHEMA_VERSION,
        actualSchemaVersion: migrationStatus.version,
      };
    }
    if (migrationStatus.status === 'empty') {
      return {
        status: 'not_ready', database: this.neo4jService.database,
        reason: 'SCHEMA_UNINITIALIZED', expectedSchemaVersion: FOUNDATION_SCHEMA_VERSION,
      };
    }
    if (migrationStatus.version !== FOUNDATION_SCHEMA_VERSION) {
      return {
        status: 'not_ready', database: this.neo4jService.database,
        reason: 'SCHEMA_VERSION_MISMATCH', expectedSchemaVersion: FOUNDATION_SCHEMA_VERSION,
        actualSchemaVersion: migrationStatus.version,
      };
    }
    return { status: 'ready', database: this.neo4jService.database, schemaVersion: FOUNDATION_SCHEMA_VERSION };
  }

  async initializeSchema(): Promise<ReadinessResult> {
    const status = await this.migrations.migrate();
    if (status.status !== 'current') {
      throw new Error(`Neo4j schema migration did not complete: ${status.status}`);
    }
    return this.checkReadiness();
  }
}
