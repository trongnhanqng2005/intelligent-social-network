import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ManagedTransaction } from 'neo4j-driver';
import { Neo4jService } from './neo4j.service.js';

export const profileUserIdPreflight = `
  MATCH (user:User)
  WHERE user.id IS NOT :: STRING NOT NULL OR
        NOT (user.id =~ '(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  RETURN count(user) AS invalidUserIds`;

export const migrationDefinitions = [
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
  {
    version: 2,
    name: 'authentication-schema',
    statements: [
      `CREATE CONSTRAINT isn_user_id IF NOT EXISTS
       FOR (user:User) REQUIRE user.id IS UNIQUE`,
      `CREATE CONSTRAINT isn_user_email IF NOT EXISTS
       FOR (user:User) REQUIRE user.email IS UNIQUE`,
      `CREATE CONSTRAINT isn_auth_session_id IF NOT EXISTS
       FOR (session:AuthSession) REQUIRE session.id IS UNIQUE`,
      `CREATE CONSTRAINT isn_auth_session_jti IF NOT EXISTS
       FOR (session:AuthSession) REQUIRE session.jti IS UNIQUE`,
      `CREATE CONSTRAINT isn_auth_event_id IF NOT EXISTS
       FOR (event:AuthActivityEvent) REQUIRE event.eventId IS UNIQUE`,
      `CREATE RANGE INDEX isn_auth_session_expires_at IF NOT EXISTS
       FOR (session:AuthSession) ON (session.expiresAt)`,
      `CREATE RANGE INDEX isn_auth_event_timestamp IF NOT EXISTS
       FOR (event:AuthActivityEvent) ON (event.timestamp)`,
    ],
  },
  {
    version: 3,
    name: 'user-profile-discovery',
    statements: [
      `CREATE TEXT INDEX isn_user_display_name_search IF NOT EXISTS
       FOR (user:User) ON (user.displayNameSearch)`,
    ],
    preflight: `
      MATCH (user:User)
      WHERE (user.displayName IS NOT NULL OR user.bio IS NOT NULL OR user.location IS NOT NULL OR
             user.profileCreatedAt IS NOT NULL OR user.profileUpdatedAt IS NOT NULL OR
             user.profileVersion IS NOT NULL OR user.displayNameSearch IS NOT NULL)
        AND NOT (user.displayName = 'Thành viên ' + substring(user.id, 0, 8) AND
                 user.bio IS NULL AND user.location IS NULL AND
                 user.profileCreatedAt IS NOT NULL AND user.profileUpdatedAt IS NOT NULL AND
                 user.profileVersion = 0 AND
                 user.displayNameSearch = 'thanh vien ' + toLower(substring(user.id, 0, 8)))
      RETURN count(user) AS conflicts`,
    dataStatements: [
      `MATCH (user:User)
       WHERE user.displayName IS NULL AND user.bio IS NULL AND user.location IS NULL AND
             user.profileCreatedAt IS NULL AND user.profileUpdatedAt IS NULL AND
             user.profileVersion IS NULL AND user.displayNameSearch IS NULL
       WITH user, datetime() AS initializedAt
       SET user.displayName = 'Thành viên ' + substring(user.id, 0, 8),
           user.displayNameSearch = 'thanh vien ' + toLower(substring(user.id, 0, 8)),
           user.profileCreatedAt = initializedAt,
           user.profileUpdatedAt = initializedAt,
           user.profileVersion = 0
       RETURN count(user) AS initialized`,
    ],
    verification: `
      MATCH (user:User)
      WHERE user.displayName IS NULL OR size(user.displayName) < 2 OR size(user.displayName) > 80 OR
            user.displayNameSearch IS NULL OR user.profileCreatedAt IS NULL OR
            user.profileUpdatedAt IS NULL OR user.profileVersion IS NULL OR user.profileVersion < 0
      RETURN count(user) AS invalidProfiles`,
  },
  {
    version: 4,
    name: 'friendship-system',
    statements: [
      `CREATE CONSTRAINT isn_friendship_pair_key IF NOT EXISTS
       FOR (pair:FriendshipPair) REQUIRE pair.pairKey IS UNIQUE`,
      `CREATE CONSTRAINT isn_friendship_request_id IF NOT EXISTS
       FOR (pair:FriendshipPair) REQUIRE pair.requestId IS UNIQUE`,
      `CREATE CONSTRAINT isn_friendship_id IF NOT EXISTS
       FOR ()-[friendship:FRIEND_WITH]-() REQUIRE friendship.id IS UNIQUE`,
      `CREATE CONSTRAINT isn_friendship_edge_pair_key IF NOT EXISTS
       FOR ()-[friendship:FRIEND_WITH]-() REQUIRE friendship.pairKey IS UNIQUE`,
      `CREATE RANGE INDEX isn_friendship_requests_sent IF NOT EXISTS
       FOR (pair:FriendshipPair) ON (pair.senderId, pair.requestStatus, pair.requestId)`,
      `CREATE RANGE INDEX isn_friendship_requests_received IF NOT EXISTS
       FOR (pair:FriendshipPair) ON (pair.recipientId, pair.requestStatus, pair.requestId)`,
    ],
    preflight: `
      CALL { MATCH (pair:FriendshipPair) RETURN count(pair) AS pairs }
      CALL { MATCH ()-[friendship:FRIEND_WITH]->() RETURN count(friendship) AS relationships }
      RETURN pairs + relationships AS conflicts`,
  },
  {
    version: 5,
    name: 'posts-feed',
    statements: [
      `CREATE CONSTRAINT isn_post_id IF NOT EXISTS
       FOR (post:Post) REQUIRE post.id IS UNIQUE`,
      `CREATE RANGE INDEX isn_post_created_at IF NOT EXISTS
       FOR (post:Post) ON (post.createdAt)`,
      `CREATE RANGE INDEX isn_post_author_created_at IF NOT EXISTS
       FOR (post:Post) ON (post.authorId, post.createdAt)`,
    ],
  },
  {
    version: 6,
    name: 'post-interactions',
    statements: [
      `CREATE CONSTRAINT isn_comment_id IF NOT EXISTS
       FOR (comment:Comment) REQUIRE comment.id IS UNIQUE`,
      `CREATE CONSTRAINT isn_like_id IF NOT EXISTS
       FOR ()-[like:LIKED]-() REQUIRE like.id IS UNIQUE`,
      `CREATE CONSTRAINT isn_share_id IF NOT EXISTS
       FOR ()-[share:SHARED]-() REQUIRE share.id IS UNIQUE`,
      `CREATE RANGE INDEX isn_comment_post_created_at IF NOT EXISTS
       FOR (comment:Comment) ON (comment.postId, comment.createdAt)`,
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

const authenticationConstraints = [
  { name: 'isn_user_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['User'], properties: ['id'] },
  { name: 'isn_user_email', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['User'], properties: ['email'] },
  { name: 'isn_auth_session_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['AuthSession'], properties: ['id'] },
  { name: 'isn_auth_session_jti', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['AuthSession'], properties: ['jti'] },
  { name: 'isn_auth_event_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['AuthActivityEvent'], properties: ['eventId'] },
] as const;

const authenticationIndexes = [
  { name: 'isn_auth_session_expires_at', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['AuthSession'], properties: ['expiresAt'] },
  { name: 'isn_auth_event_timestamp', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['AuthActivityEvent'], properties: ['timestamp'] },
] as const;

const profileIndexes = [
  { name: 'isn_user_display_name_search', type: 'TEXT', entityType: 'NODE', labelsOrTypes: ['User'], properties: ['displayNameSearch'] },
] as const;

const friendshipConstraints = [
  { name: 'isn_friendship_pair_key', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['FriendshipPair'], properties: ['pairKey'] },
  { name: 'isn_friendship_request_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['FriendshipPair'], properties: ['requestId'] },
  { name: 'isn_friendship_id', type: 'RELATIONSHIP_PROPERTY_UNIQUENESS', entityType: 'RELATIONSHIP', labelsOrTypes: ['FRIEND_WITH'], properties: ['id'] },
  { name: 'isn_friendship_edge_pair_key', type: 'RELATIONSHIP_PROPERTY_UNIQUENESS', entityType: 'RELATIONSHIP', labelsOrTypes: ['FRIEND_WITH'], properties: ['pairKey'] },
] as const;

const friendshipIndexes = [
  { name: 'isn_friendship_requests_sent', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['FriendshipPair'], properties: ['senderId', 'requestStatus', 'requestId'] },
  { name: 'isn_friendship_requests_received', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['FriendshipPair'], properties: ['recipientId', 'requestStatus', 'requestId'] },
] as const;

const postConstraints = [
  { name: 'isn_post_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['Post'], properties: ['id'] },
] as const;

const postIndexes = [
  { name: 'isn_post_created_at', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['Post'], properties: ['createdAt'] },
  { name: 'isn_post_author_created_at', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['Post'], properties: ['authorId', 'createdAt'] },
] as const;

const interactionConstraints = [
  { name: 'isn_comment_id', type: 'NODE_PROPERTY_UNIQUENESS', entityType: 'NODE', labelsOrTypes: ['Comment'], properties: ['id'] },
  { name: 'isn_like_id', type: 'RELATIONSHIP_PROPERTY_UNIQUENESS', entityType: 'RELATIONSHIP', labelsOrTypes: ['LIKED'], properties: ['id'] },
  { name: 'isn_share_id', type: 'RELATIONSHIP_PROPERTY_UNIQUENESS', entityType: 'RELATIONSHIP', labelsOrTypes: ['SHARED'], properties: ['id'] },
] as const;

const interactionIndexes = [
  { name: 'isn_comment_post_created_at', type: 'RANGE', entityType: 'NODE', labelsOrTypes: ['Comment'], properties: ['postId', 'createdAt'] },
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
  preflight?: string;
  dataStatements?: readonly string[];
  verification?: string;
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
      return !definition || record.name !== definition.name || record.checksum !== checksumMigration(definition);
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
    ) && inspection.schemaValid && inspection.markerVersion === migrationDefinitions.at(-1)?.version;

    const resultStatus = current
      ? 'current'
      : pending
        ? 'incomplete'
        : inspection.history.length === 0
          ? 'empty'
          : inspection.markerVersion < (migrationDefinitions.at(-1)?.version ?? 0)
            ? 'incomplete'
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

    const recordedV4 = priorStatus.migrations.find((migration) => migration.version === 4);
    if (recordedV4 && recordedV4.status !== 'VERIFIED') {
      throw new Error('An interrupted V4 migration requires manual read-only inspection; no migration writes were made');
    }
    const verifiedV3 = priorStatus.version === 3 && priorStatus.migrations.length === 3 &&
      migrationDefinitions.slice(0, 3).every((definition) => {
        const record = priorStatus.migrations.find((migration) => migration.version === definition.version);
        return record?.name === definition.name && record.checksum === checksumMigration(definition) &&
          record.status === 'VERIFIED' && record.appliedAt !== null && record.verifiedAt !== null;
      });
    if (verifiedV3) {
      const preflight = await this.neo4jService.executeRead((transaction) =>
        transaction.run(migrationDefinitions[3].preflight!),
      );
      if (asNumber(preflight.records[0]?.get('conflicts')) !== 0) {
        throw new Error('Friendship migration found existing friendship data that requires manual review; no V4 writes were made');
      }
      await this.preflightFriendshipSchema();
    }

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

      if ('preflight' in migration && migration.preflight) {
        const preflight = await this.neo4jService.executeRead((transaction) =>
          transaction.run(migration.preflight!),
        );
        if (asNumber(preflight.records[0]?.get('conflicts')) !== 0) {
          if (migration.version === 3) {
            throw new Error('Profile migration found existing profile data that requires manual review; no V3 writes were made');
          }
          if (migration.version === 4) {
            throw new Error('Friendship migration found existing friendship data that requires manual review; no V4 writes were made');
          }
        }
      }

      if (migration.version === 4) await this.preflightFriendshipSchema();

      if (migration.version === 3) {
        const usersWithoutId = await this.neo4jService.executeRead((transaction) =>
          transaction.run(profileUserIdPreflight),
        );
        if (!isProfileUserIdPreflightValid(usersWithoutId.records)) {
          throw new Error('Profile migration requires every existing User ID to be a UUID; no V3 writes were made');
        }
      }

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
        for (const statement of 'dataStatements' in migration ? migration.dataStatements : []) {
          await this.neo4jService.executeWrite(async (transaction) => {
            await transaction.run(statement);
          });
        }
        if ('verification' in migration && migration.verification) {
          const verification = await this.neo4jService.executeRead((transaction) =>
            transaction.run(migration.verification!),
          );
          if (asNumber(verification.records[0]?.get('invalidProfiles')) !== 0) {
            throw new Error('Profile backfill verification failed');
          }
        }
        await this.neo4jService.executeWrite((transaction) => transaction.run(
          `MERGE (schema:ISNSchema {key: $key})
           SET schema.version = $version`,
          { key: 'application', version: migration.version },
        ).then(() => undefined));

        const inspection = await this.neo4jService.executeRead((transaction) =>
          this.inspect(transaction),
        );
        if (inspection.database !== this.neo4jService.database || !inspection.schemaValid) {
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

  private async preflightFriendshipSchema(): Promise<void> {
    const existing = await this.neo4jService.executeRead(async (transaction) => {
      const constraints = await transaction.run(
        'SHOW CONSTRAINTS YIELD name, entityType, labelsOrTypes RETURN name, entityType, labelsOrTypes',
      );
      const indexes = await transaction.run(
        'SHOW INDEXES YIELD name, entityType, labelsOrTypes RETURN name, entityType, labelsOrTypes',
      );
      return [...constraints.records, ...indexes.records].filter((record) => {
        const labelsOrTypes = record.get('labelsOrTypes');
        return Array.isArray(labelsOrTypes) &&
          labelsOrTypes.some((value) => value === 'FriendshipPair' || value === 'FRIEND_WITH');
      }).map((record) => String(record.get('name')));
    });
    if (existing.length) {
      throw new Error(`Unexpected Friendship schema objects exist (${existing.join(', ')}); no V4 writes were made`);
    }
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
    const indexes = await transaction.run(
      'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
    );
    const indexRows = indexes.records.map((record) => Object.fromEntries(
      ['name', 'type', 'entityType', 'labelsOrTypes', 'properties', 'state'].map((key) => [key, record.get(key)]),
    ));
    const historyRecords = history.records.map((record) => ({
      version: asNumber(record.get('version')),
      name: String(record.get('name') ?? ''),
      checksum: String(record.get('checksum') ?? ''),
      status: String(record.get('status') ?? ''),
      appliedAt: typeof record.get('appliedAt') === 'string' ? record.get('appliedAt') as string : null,
      verifiedAt: typeof record.get('verifiedAt') === 'string' ? record.get('verifiedAt') as string : null,
    }));
    const markerVersion = asNumber(marker.records[0]?.get('version'));
    const expectedConstraints: {
      name: string;
      type: string;
      entityType: string;
      labelsOrTypes: readonly string[];
      properties: readonly string[];
    }[] = markerVersion >= 2
      ? [...requiredConstraints, ...authenticationConstraints]
      : markerVersion >= 1 ? [...requiredConstraints] : [];
    if (markerVersion >= 4) expectedConstraints.push(...friendshipConstraints);
    if (markerVersion >= 5) expectedConstraints.push(...postConstraints);
    if (markerVersion >= 6) expectedConstraints.push(...interactionConstraints);
    const constraintsValid = expectedConstraints.every((expected) => {
      const actual = constraintRows.find((constraint) => constraint.name === expected.name);
      return actual !== undefined && matchesConstraint(actual, expected);
    });
    const indexesValid = markerVersion < 2 || authenticationIndexes.every((expected) => {
      const actual = indexRows.find((index) => index.name === expected.name);
      return actual !== undefined && matchesIndex(actual, expected);
    });
    const profileIndexesValid = markerVersion < 3 || profileIndexes.every((expected) => {
      const actual = indexRows.find((index) => index.name === expected.name);
      return actual !== undefined && matchesIndex(actual, expected);
    });
    const friendshipIndexesValid = markerVersion < 4 || friendshipIndexes.every((expected) => {
      const actual = indexRows.find((index) => index.name === expected.name);
      return actual !== undefined && matchesIndex(actual, expected);
    });
    const postIndexesValid = markerVersion < 5 || postIndexes.every((expected) => {
      const actual = indexRows.find((index) => index.name === expected.name);
      return actual !== undefined && matchesIndex(actual, expected);
    });
    const interactionIndexesValid = markerVersion < 6 || interactionIndexes.every((expected) => {
      const actual = indexRows.find((index) => index.name === expected.name);
      return actual !== undefined && matchesIndex(actual, expected);
    });
    const profileVerification = markerVersion < 3
      ? undefined
      : await transaction.run(migrationDefinitions[2].verification);
    const profilesValid = markerVersion < 3 ||
      isProfileVerificationValid(profileVerification?.records ?? []);
    return {
      database: identity.records[0]?.get('database'),
      markerVersion,
      history: historyRecords,
      schemaValid: constraintsValid && indexesValid && profileIndexesValid && friendshipIndexesValid && postIndexesValid && interactionIndexesValid && profilesValid,
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

function matchesIndex(actual: Record<string, unknown>, expected: {
  name: string; type: string; entityType: string; labelsOrTypes: readonly string[]; properties: readonly string[];
}): boolean {
  return actual.type === expected.type && actual.entityType === expected.entityType &&
    actual.state === 'ONLINE' && sameList(actual.labelsOrTypes, expected.labelsOrTypes) &&
    sameList(actual.properties, expected.properties);
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
  return Number.NaN;
}

export function isProfileVerificationValid(records: readonly { get(key: string): unknown }[]): boolean {
  const record = records[0];
  return records.length === 1 && record !== undefined && asNumber(record.get('invalidProfiles')) === 0;
}

export function isProfileUserIdPreflightValid(records: readonly { get(key: string): unknown }[]): boolean {
  const record = records[0];
  return records.length === 1 && record !== undefined && asNumber(record.get('invalidUserIds')) === 0;
}

function matchesConstraint(actual: Record<string, unknown>, expected: {
  name: string; type: string; entityType: string; labelsOrTypes: readonly string[]; properties: readonly string[];
}): boolean {
  return actual.type === expected.type &&
    actual.entityType === expected.entityType &&
    sameList(actual.labelsOrTypes, expected.labelsOrTypes) &&
    sameList(actual.properties, expected.properties);
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value);
}
