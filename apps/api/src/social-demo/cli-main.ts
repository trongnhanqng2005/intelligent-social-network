import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Neo4jOperationsModule } from '../neo4j/neo4j-operations.module.js';
import { Neo4jService } from '../neo4j/neo4j.service.js';
import { Neo4jMigrationService } from '../neo4j/neo4j-migrations.js';
import { NEO4J_DRIVER } from '../neo4j/neo4j.constants.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { applyFixture } from './fixture.js';
import { loadOrCreateManifest, readManifest } from './manifest.js';

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--apply')) throw new Error('Usage: social-demo [--apply]');
  const apply = args.includes('--apply');
  if (process.env.NODE_ENV !== 'development') throw new Error('Refusing: NODE_ENV must be development');
  if (process.env.ACTIVITY_CAPTURE_ENABLED === 'true') throw new Error('Refusing: activity capture must be disabled');

  const app = await NestFactory.createApplicationContext(Neo4jOperationsModule, { logger: false });
  try {
    const config = app.get(ConfigService);
    const neo4j = app.get(Neo4jService);
    const migrations = app.get(Neo4jMigrationService);
    const driver = app.get(NEO4J_DRIVER);
    const uri = new URL(config.getOrThrow<string>('NEO4J_URI'));
    const configuredTargetReady = config.getOrThrow<string>('NEO4J_DATABASE') === 'isn-dev' &&
      neo4j.database === 'isn-dev' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname);

    if (!configuredTargetReady) {
      console.error('Refusing: configured target is not loopback isn-dev');
      throw new Error('target readiness failed');
    }
    const identity = await neo4j.executeRead(async (tx) => {
      const result = await tx.run('CALL db.info() YIELD name, id RETURN name AS database, id AS id');
      return { database: result.records[0]?.get('database'), id: result.records[0]?.get('id') };
    });
    if (identity.database !== 'isn-dev' || typeof identity.id !== 'string' || !identity.id) {
      throw new Error('Refusing: database identity mismatch; inventory withheld');
    }
    const status = await migrations.getStatus();
    const inventory = await neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `CALL { MATCH (n:User) RETURN count(n) AS users }
         CALL { MATCH (n:Post) RETURN count(n) AS posts }
         CALL { MATCH (n:FriendshipPair) RETURN count(n) AS pairs }
         CALL { MATCH (n:Comment) RETURN count(n) AS comments }
          CALL { MATCH (u:User) WHERE u.email IN $reservedEmails
                RETURN collect({id:u.id,email:u.email}) AS reserved }
          RETURN users, posts, pairs, comments, reserved`,
        { reservedEmails: Array.from({ length: 12 }, (_, i) => `social-demo-${String(i + 1).padStart(2, '0')}@example.test`) },
      );
      return result.records[0];
    });
    if (!inventory) throw new Error('Read-only inventory unavailable');
    console.log(`Target=${String(identity.database)} schema=${status.status}/V${status.version ?? 'unknown'} inventory users=${number(inventory.get('users'))} posts=${number(inventory.get('posts'))} friendshipPairs=${number(inventory.get('pairs'))} comments=${number(inventory.get('comments'))}.`);
    const schemaReady = status.status === 'current' && status.version === 8 && status.database === 'isn-dev';
    if (!schemaReady) {
      console.error(`Blocked: current V8 schema required; read-only status=${status.status} version=${status.version ?? 'unknown'}`);
      throw new Error('schema readiness failed');
    }
    if (!apply) {
      console.log('Read-only preflight passed. No filesystem or database writes performed.');
      return;
    }

    const existingManifest = await readManifest('isn-dev', identity.id);
    const reserved = inventory.get('reserved') as Array<{ id: string; email: string }>;
    if (!existingManifest && reserved.length) {
      throw new Error('Refusing: reserved fixture email exists without a valid owner manifest; no writes made');
    }
    const manifest = existingManifest ?? await loadOrCreateManifest('isn-dev', identity.id);
    const ownership = await neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `MATCH (u:User) WHERE u.id IN $ids OR u.email IN $emails
         RETURN collect({id:u.id,email:u.email}) AS users`,
        { ids: manifest.users.map((u) => u.id), emails: manifest.users.map((u) => u.email) },
      );
      return result.records[0]?.get('users') as Array<{ id: string; email: string }>;
    });
    assertOwnership(ownership, manifest.users);
    if (ownership.length === manifest.users.length) {
      console.log('Exact owned roster already exists; deliberate no-op (no repair or reset).');
      return;
    }

    const passwords = new PasswordService();
    const passwordHashes: string[] = [];
    for (const user of manifest.users) passwordHashes.push(await passwords.hash(user.password));

    const result = await neo4j.executeWriteOnce(async (transaction) => {
      const identityCheck = await transaction.run('CALL db.info() YIELD name, id RETURN name AS database, id AS id');
      const record = identityCheck.records[0];
      if (record?.get('database') !== 'isn-dev' || record.get('id') !== identity.id) {
        throw new Error('Refusing: database identity changed before write');
      }
      const again = await transaction.run(
        `MATCH (u:User) WHERE u.id IN $ids OR u.email IN $emails
         RETURN collect({id:u.id,email:u.email}) AS users`,
        { ids: manifest.users.map((u) => u.id), emails: manifest.users.map((u) => u.email) },
      );
      const matches = again.records[0]?.get('users') as Array<{ id: string; email: string }>;
      if (matches.length) throw new Error('Refusing: fixture ownership changed before write');
      return applyFixture({ driver, database: 'isn-dev', transaction, manifest, passwordHashes });
    });
    console.log(`Seed committed: users=${result.users} acceptedFriendships=${result.friendships} pendingRequests=${result.pending} posts=${result.posts} comments=${result.comments} likes=${result.likes}. Credentials are stored only in the private owner manifest.`);
  } finally {
    await app.close();
  }
}

function assertOwnership(actual: Array<{ id: string; email: string }>, expected: Array<{ id: string; email: string }>): void {
  if (!actual.length) return;
  if (actual.length !== expected.length) throw new Error('Refusing: partial or mismatched fixture ownership roster');
  const actualPairs = new Set(actual.map((user) => `${user.id}\0${user.email}`));
  if (expected.some((user) => !actualPairs.has(`${user.id}\0${user.email}`))) {
    throw new Error('Refusing: partial or mismatched fixture ownership roster');
  }
}

function number(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') return value.toNumber();
  return Number.NaN;
}
