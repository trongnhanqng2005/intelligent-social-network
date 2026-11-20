import { NestFactory } from '@nestjs/core';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { UsersService } from '../modules/users/users.service.js';
import { DEMO_ACCOUNTS, DEMO_ADMIN, DEMO_MEMBERS, DEMO_PASSWORD, LEGACY_EMAILS } from './accounts.js';
import { main } from './cli-main.js';
import { applyFixture } from './fixture.js';
import { readManifest } from './manifest.js';

jest.mock('@nestjs/core', () => ({ NestFactory: { createApplicationContext: jest.fn() } }));
jest.mock('../neo4j/neo4j-operations.module.js', () => ({ Neo4jOperationsModule: class {} }));
jest.mock('./fixture.js', () => ({ applyFixture: jest.fn() }));
jest.mock('./manifest.js', () => ({ readManifest: jest.fn() }));

const oldUsers = DEMO_MEMBERS.map(({ displayName }, index) => ({
  id: `owned-${index}`, email: LEGACY_EMAILS[index]!, password: 'legacy-fixture-password', displayName,
}));

type Row = Record<string, unknown>;

function result(rows: Row[]) {
  return { records: rows.map(row => ({ get: (key: string) => row[key] })) };
}

describe('social demo CLI', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;
  let identity: Row;
  let roster: Row[];
  let legacy: Row[];
  let databaseVersion: number;
  let legacyGraphVerified: boolean;
  let uri: string;
  let run: jest.Mock;
  let write: jest.Mock;
  let read: jest.Mock;
  let status: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'development', ACTIVITY_CAPTURE_ENABLED: 'false' };
    process.argv = ['node', 'cli.js', '--apply'];
    identity = { database: 'isn-dev', id: 'db-id' };
    roster = [];
    legacy = [];
    databaseVersion = 8;
    legacyGraphVerified = true;
    uri = 'bolt://localhost:7687';
    run = jest.fn(async (query: string, params?: Row) => {
      if (query.includes('db.info')) return result([identity]);
      if (query.includes('AS owned')) return result(roster);
      if (query.includes('u.passwordHash AS hash')) return result(legacy);
      if (query.includes('AS verified')) return result([{ verified: legacyGraphVerified }]);
      if (query.includes('UNWIND $updates')) {
        // Legacy fixture accounts have an implicit USER role until the upgrade persists it.
        roster = (params!.updates as Array<{ email: string }>).map(({ email }) => ({
          email, role: query.includes("u.role = 'USER'")
            ? 'USER' : null, owned: true,
        }));
        return result([{ changed: DEMO_MEMBERS.length }]);
      }
      if (query.includes("u.role = 'ADMIN'")) {
        roster.push({ email: params!.email, role: 'ADMIN', owned: true });
        return result([]);
      }
      if (query.includes('u.socialDemoVersion = 2')) {
        roster = DEMO_MEMBERS.map(({ email, role }) => ({ email, role, owned: true }));
        return result([]);
      }
      throw new Error(`Unhandled fake transaction query: ${query}`);
    });
    read = jest.fn(async (callback) => callback({ run }));
    write = jest.fn(async (callback) => callback({ run }));
    status = jest.fn(async () => ({ status: 'current', version: databaseVersion, database: 'isn-dev' }));
    jest.mocked(readManifest).mockImplementation(async () => legacy.length
      ? { datasetVersion: 1, database: 'isn-dev', databaseId: 'db-id', users: oldUsers }
      : undefined);
    jest.mocked(applyFixture).mockResolvedValue({ users: 12, friendships: 18, pending: 5, posts: 27, comments: 48, likes: 75 });
    jest.mocked(NestFactory.createApplicationContext).mockResolvedValue({
      get: (token: { name?: string }) => {
        if (token?.name === 'ConfigService') return { getOrThrow: (key: string) => key === 'NEO4J_URI' ? uri : 'isn-dev' };
        if (token?.name === 'Neo4jService') return { database: 'isn-dev', executeRead: read, executeWriteOnce: write };
        if (token?.name === 'Neo4jMigrationService') return { getStatus: status };
        return {};
      },
      close: jest.fn(),
    } as never);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(PasswordService.prototype, 'hash').mockResolvedValue('new-hash');
    jest.spyOn(PasswordService.prototype, 'verify').mockResolvedValue(true);
    jest.spyOn(AuthRepository.prototype, 'register').mockResolvedValue({ id: 'admin', email: DEMO_ADMIN.email, role: 'USER' });
    jest.spyOn(UsersService.prototype, 'updateOwnProfile').mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  function legacyRoster() {
    return oldUsers.map(({ id, email, displayName }) => ({ id, email, displayName, role: 'USER', version: null, hash: 'old-hash' }));
  }

  it('blocks a non-V8 schema without inspecting or writing fixtures', async () => {
    databaseVersion = 7;
    await expect(main()).rejects.toThrow('Current V8 required');
    expect(readManifest).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a non-local target before querying the database', async () => {
    uri = 'bolt://remote.example:7687';
    await expect(main()).rejects.toThrow('requires loopback isn-dev');
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses an unexpected reported identity before migration or inventory reads', async () => {
    identity.database = 'unexpected-db';
    await expect(main()).rejects.toThrow('database identity mismatch');
    expect(read).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not write a complete owned v2 roster on replay', async () => {
    roster = DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role, owned: true }));
    await main();
    expect(write).not.toHaveBeenCalled();
    expect(PasswordService.prototype.hash).not.toHaveBeenCalled();
  });

  it.each([false, true])('refuses an unowned collision or partial roster (owned=%s)', async owned => {
    roster = [{ email: DEMO_MEMBERS[0]!.email, role: 'USER', owned }];
    await expect(main()).rejects.toThrow('collides with an unowned account');
    expect(write).not.toHaveBeenCalled();
  });

  it('seeds 12 members and a separate administrator using the application password hasher', async () => {
    await main();
    expect(PasswordService.prototype.hash).toHaveBeenCalledTimes(13);
    expect(PasswordService.prototype.hash).toHaveBeenCalledWith(DEMO_PASSWORD);
    expect(write).toHaveBeenCalledTimes(1);
    expect(applyFixture).toHaveBeenCalledWith(expect.objectContaining({
      manifest: { users: DEMO_MEMBERS.map(account => expect.objectContaining(account)) },
    }));
    expect(AuthRepository.prototype.register).toHaveBeenCalledWith(expect.objectContaining({ email: DEMO_ADMIN.email, passwordHash: 'new-hash' }));
  });

  it('upgrades the verified v1 IDs in place and materializes the implicit USER role before checking v2', async () => {
    process.argv.push('--expected-comments=50');
    process.argv[2] = '--upgrade-v1';
    legacy = legacyRoster();
    await main();
    expect(run).toHaveBeenCalledWith(expect.stringContaining('AS verified'), { ids: oldUsers.map(user => user.id), expectedComments: 50 });
    expect(run).toHaveBeenCalledWith(expect.stringContaining('UNWIND $updates'), {
      updates: oldUsers.map((user, index) => ({
        id: user.id, email: DEMO_MEMBERS[index]!.email, oldEmail: user.email, oldHash: 'old-hash', passwordHash: 'new-hash',
      })),
    });
    expect(roster).toEqual(DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role, owned: true })));
    expect(applyFixture).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('refuses a legacy boundary mismatch before starting a write', async () => {
    process.argv[2] = '--upgrade-v1';
    legacy = legacyRoster();
    legacyGraphVerified = false;
    await expect(main()).rejects.toThrow('Legacy graph differs from the fixture');
    expect(write).not.toHaveBeenCalled();
  });
});
