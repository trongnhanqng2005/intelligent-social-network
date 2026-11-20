import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { ManagedTransaction, Transaction } from 'neo4j-driver';
import { Neo4jOperationsModule } from '../neo4j/neo4j-operations.module.js';
import { Neo4jService } from '../neo4j/neo4j.service.js';
import { Neo4jMigrationService } from '../neo4j/neo4j-migrations.js';
import { NEO4J_DRIVER } from '../neo4j/neo4j.constants.js';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { UsersRepository } from '../modules/users/users.repository.js';
import { UsersService } from '../modules/users/users.service.js';
import { DEMO_ACCOUNTS, DEMO_ADMIN, DEMO_MEMBERS, DEMO_PASSWORD, isLoopbackUrl, SocialDemoRefusal } from './accounts.js';
import { applyFixture } from './fixture.js';
import { inspectLegacy } from './legacy.js';
import { TransactionNeo4jService } from './transaction-neo4j.service.js';

type DemoTransaction = ManagedTransaction | Transaction;

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, extra] = args;
  const reviewedCommentCount = extra?.match(/^--expected-comments=([1-9]\d*)$/)?.[1];
  const legacyCommand = command === '--inspect-v1' || command === '--upgrade-v1';
  const expectedComments = reviewedCommentCount ? Number(reviewedCommentCount) : 48;
  if (args.length > 2 || (command && command !== '--apply' && !legacyCommand) ||
      (extra && (!legacyCommand || !reviewedCommentCount || !Number.isSafeInteger(expectedComments) || expectedComments < 48))) {
    throw new SocialDemoRefusal('Usage: social-demo [--apply|--upgrade-v1|--inspect-v1] [--expected-comments=count]');
  }
  if (process.env.NODE_ENV !== 'development' || process.env.ACTIVITY_CAPTURE_ENABLED === 'true') {
    throw new SocialDemoRefusal('Social demo requires NODE_ENV=development and activity capture disabled.');
  }

  const app = await NestFactory.createApplicationContext(Neo4jOperationsModule, { logger: false });
  try {
    const config = app.get(ConfigService);
    const neo4j = app.get(Neo4jService);
    const migrations = app.get(Neo4jMigrationService);
    if (config.getOrThrow<string>('NEO4J_DATABASE') !== 'isn-dev' || neo4j.database !== 'isn-dev' ||
        !isLoopbackUrl(config.getOrThrow<string>('NEO4J_URI'))) {
      throw new SocialDemoRefusal('Social demo requires loopback isn-dev.');
    }

    const databaseId = await neo4j.executeRead(readIdentity);
    const status = await migrations.getStatus();
    if (command === '--inspect-v1') {
      const legacy = await neo4j.executeRead(tx => inspectLegacy(tx, databaseId, expectedComments));
      console.log(`Read-only inspection of isn-dev (${databaseId}): schema=${status.status}/V${status.version}, verified legacy accounts=${legacy.length}${legacy.length ? `, reviewed comments=${expectedComments}` : ''}.`);
      return;
    }
    if (status.status !== 'current' || status.version !== 8 || status.database !== 'isn-dev') {
      throw new SocialDemoRefusal(`Current V8 required; schema=${status.status}/V${status.version ?? 'unknown'}.`);
    }

    const inspect = async (tx: DemoTransaction) => {
      if (await readIdentity(tx) !== databaseId) throw new SocialDemoRefusal('Database identity changed.');
      const present = await v2Exists(tx);
      const legacy = await inspectLegacy(tx, databaseId, expectedComments);
      if (present && legacy.length) throw new SocialDemoRefusal('Both legacy and v2 accounts are present.');
      return { present, legacy };
    };

    const { present, legacy } = await neo4j.executeRead(inspect);
    if (!command || present) {
      console.log(`Preflight passed on isn-dev V8: ${present ? '13 owned v2 accounts; seed is a no-op' : `${legacy.length} verified legacy accounts; v2 absent`}.`);
      return;
    }
    if (Boolean(legacy.length) !== (command === '--upgrade-v1')) {
      throw new SocialDemoRefusal(legacy.length
        ? 'Legacy dataset detected. Use the documented backup and --upgrade-v1 procedure.'
        : 'No verified legacy dataset to upgrade. Use --apply to seed an empty demo roster.');
    }

    const passwords = new PasswordService();
    const passwordHashes: string[] = [];
    for (let i = 0; i < DEMO_ACCOUNTS.length; i++) passwordHashes.push(await passwords.hash(DEMO_PASSWORD));
    const driver = app.get(NEO4J_DRIVER);
    const outcome = await neo4j.executeWriteOnce(async transaction => {
      const current = await inspect(transaction);
      if (current.present || JSON.stringify(current.legacy) !== JSON.stringify(legacy)) {
        throw new SocialDemoRefusal('Demo ownership changed before write.');
      }

      const members = DEMO_MEMBERS.map((account, index) => ({
        ...account, id: legacy[index]?.id ?? randomUUID(), password: DEMO_PASSWORD,
      }));
      if (legacy.length) {
        const updates = members.map(({ id, email }, i) => ({
          id, email, oldEmail: legacy[i]!.email, oldHash: legacy[i]!.hash, passwordHash: passwordHashes[i]!,
        }));
        const changed = await transaction.run(
          `UNWIND $updates AS entry
           MATCH (u:User {id: entry.id})
           SET u.passwordHash = u.passwordHash
           WITH u, entry WHERE u.email = entry.oldEmail AND u.passwordHash = entry.oldHash
             AND coalesce(u.role, 'USER') = 'USER' AND u.socialDemoVersion IS NULL
           SET u.email = entry.email, u.passwordHash = entry.passwordHash,
               u.role = 'USER', u.socialDemoVersion = 2
           WITH u
           OPTIONAL MATCH (u)-[:HAS_AUTH_SESSION]->(session:AuthSession)
           WHERE session.revokedAt IS NULL
           SET session.revokedAt = datetime()
           RETURN count(DISTINCT u) AS changed`,
          { updates },
        );
        if (Number(changed.records[0]?.get('changed')) !== members.length) throw new SocialDemoRefusal('Legacy accounts changed during upgrade.');
      } else {
        await applyFixture({ driver, database: 'isn-dev', transaction, manifest: { users: members }, passwordHashes });
        await transaction.run(
          'MATCH (u:User) WHERE u.id IN $ids SET u.socialDemoVersion = 2',
          { ids: members.map(({ id }) => id) },
        );
      }

      const adminId = randomUUID();
      const scoped = new TransactionNeo4jService(driver, 'isn-dev', transaction);
      await new AuthRepository(scoped).register({
        id: adminId, email: DEMO_ADMIN.email, passwordHash: passwordHashes.at(-1)!,
        eventId: randomUUID(), now: new Date().toISOString(),
      });
      await new UsersService(new UsersRepository(scoped)).updateOwnProfile(adminId, {
        displayName: DEMO_ADMIN.displayName, expectedVersion: 0,
      });
      await transaction.run(
        "MATCH (u:User {id: $id, email: $email}) SET u.role = 'ADMIN', u.socialDemoVersion = 2",
        { id: adminId, email: DEMO_ADMIN.email },
      );
      if (!await v2Exists(transaction)) throw new SocialDemoRefusal('Could not verify the v2 roster before commit.');
      return legacy.length ? 'Upgraded v1 identities in place, preserving the graph and audit history.' : 'Created the v2 social fixture.';
    });
    console.log(`${outcome} Committed 12 USER accounts and 1 ADMIN on isn-dev V8.`);
  } finally {
    await app.close();
  }
}

async function readIdentity(tx: DemoTransaction): Promise<string> {
  const result = await tx.run('CALL db.info() YIELD name, id RETURN name AS database, id');
  const row = result.records[0];
  const id = row?.get('id');
  if (row?.get('database') !== 'isn-dev' || typeof id !== 'string' || !id) {
    throw new SocialDemoRefusal('Reported database identity mismatch.');
  }
  return id;
}

async function v2Exists(tx: DemoTransaction): Promise<boolean> {
  const result = await tx.run(
    `MATCH (u:User) WHERE u.email IN $emails OR u.socialDemoVersion = 2
     RETURN u.email AS email, u.role AS role, coalesce(u.socialDemoVersion = 2, false) AS owned`,
    { emails: DEMO_ACCOUNTS.map(({ email }) => email) },
  );
  if (!result.records.length) return false;
  if (result.records.length !== DEMO_ACCOUNTS.length || !DEMO_ACCOUNTS.every(account =>
    result.records.some(row =>
      row.get('owned') === true && row.get('email') === account.email && row.get('role') === account.role,
    ),
  )) {
    throw new SocialDemoRefusal('Demo v2 roster is partial, has unexpected roles, or collides with an unowned account.');
  }
  return true;
}
