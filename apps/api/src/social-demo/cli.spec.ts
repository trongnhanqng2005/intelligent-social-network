import { main } from './cli-main.js';
import { NestFactory } from '@nestjs/core';
import { readManifest, loadOrCreateManifest } from './manifest.js';
import { applyFixture } from './fixture.js';
import { PasswordService } from '../modules/auth/password.service.js';

jest.mock('@nestjs/core', () => ({ NestFactory: { createApplicationContext: jest.fn() } }));
jest.mock('../neo4j/neo4j-operations.module.js', () => ({ Neo4jOperationsModule: class {} }));
jest.mock('./manifest.js', () => ({ readManifest: jest.fn(), loadOrCreateManifest: jest.fn() }));
jest.mock('./fixture.js', () => ({ applyFixture: jest.fn() }));

const manifest = {
  datasetVersion: 1, database: 'isn-dev', databaseId: 'db-id',
  users: Array.from({ length: 12 }, (_, i) => ({
    id: `id-${i}`, email: `social-demo-${String(i + 1).padStart(2, '0')}@example.test`,
    password: `strong-password-${i}-long-enough`, displayName: `User ${i}`,
  })),
};

describe('social demo CLI', () => {
  const originalEnv = { nodeEnv: process.env.NODE_ENV, capture: process.env.ACTIVITY_CAPTURE_ENABLED, argv: process.argv };
  let context: any;
  let ownership: Array<{ id: string; email: string }>;
  let writeCount: number;
  let neo4j: any;
  let getStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    delete process.env.ACTIVITY_CAPTURE_ENABLED;
    process.argv = ['node', 'cli.js', '--apply'];
    ownership = [];
    writeCount = 0;
    getStatus = jest.fn(async () => ({ status: 'current', version: 8, database: 'isn-dev' }));
    (readManifest as jest.Mock).mockResolvedValue(manifest);
    (loadOrCreateManifest as jest.Mock).mockResolvedValue(manifest);
    (applyFixture as jest.Mock).mockResolvedValue({ users: 12, friendships: 18, pending: 5, posts: 32, comments: 50, likes: 75 });
    const records = (value: any) => ({ records: [{ get: (key: string) => value[key] }] });
    const tx = { run: jest.fn(async (query: string) => query.includes('db.info')
      ? records({ database: 'isn-dev', id: 'db-id' })
      : records({ users: ownership })) };
    neo4j = {
      database: 'isn-dev',
      executeRead: jest.fn(async (callback: any) => callback(tx)),
      executeWriteOnce: jest.fn(async (callback: any) => {
        writeCount++;
        const writeTx = { run: jest.fn(async (query: string) => query.includes('db.info')
          ? records({ database: 'isn-dev', id: 'db-id' })
          : records({ users: [] })) };
        return callback(writeTx);
      }),
    };
    context = {
      get: (token: any) => token?.name === 'ConfigService'
        ? { getOrThrow: (key: string) => key === 'NEO4J_URI' ? 'bolt://localhost:7687' : 'isn-dev' }
        : token?.name === 'Neo4jService' ? neo4j
          : token?.name === 'Neo4jMigrationService' ? { getStatus }
            : {},
      close: jest.fn(),
    };
    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue(context);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.argv = originalEnv.argv;
    if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv.nodeEnv;
    if (originalEnv.capture === undefined) delete process.env.ACTIVITY_CAPTURE_ENABLED; else process.env.ACTIVITY_CAPTURE_ENABLED = originalEnv.capture;
  });

  it('blocks a non-V8 schema without writes', async () => {
    context.get = (token: any) => token?.name === 'ConfigService'
      ? { getOrThrow: (key: string) => key === 'NEO4J_URI' ? 'bolt://localhost:7687' : 'isn-dev' }
      : token?.name === 'Neo4jService' ? { database: 'isn-dev', executeRead: async (cb: any) => cb({ run: async () => ({ records: [{ get: (key: string) => key === 'database' ? 'isn-dev' : 'db-id' }] }) }), executeWriteOnce: jest.fn() }
        : token?.name === 'Neo4jMigrationService' ? { getStatus: async () => ({ status: 'current', version: 4, database: 'isn-dev' }) } : {};
    await expect(main()).rejects.toThrow();
    expect(writeCount).toBe(0);
  });

  it('refuses a wrong configured target', async () => {
    const get = context.get;
    context.get = (token: any) => token?.name === 'ConfigService'
      ? { getOrThrow: (key: string) => key === 'NEO4J_URI' ? 'bolt://remote.example:7687' : 'isn-dev' }
      : get(token);
    await expect(main()).rejects.toThrow();
    expect(neo4j.executeRead).toHaveBeenCalledTimes(0);
    expect(getStatus).toHaveBeenCalledTimes(0);
    expect(writeCount).toBe(0);
  });

  it('refuses an unexpected reported identity before migration status or inventory reads', async () => {
    const run = jest.fn(async (query: string) => query.includes('db.info')
      ? { records: [{ get: (key: string) => key === 'database' ? 'unexpected-db' : 'db-id' }] }
      : { records: [{ get: () => ownership }] });
    neo4j.executeRead.mockImplementation(async (callback: any) => callback({ run }));
    await expect(main()).rejects.toThrow('database identity mismatch');
    expect(neo4j.executeRead).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(0);
    expect(writeCount).toBe(0);
  });

  it('does not write an exact owned replay', async () => {
    ownership = manifest.users.map(({ id, email }) => ({ id, email }));
    await main();
    expect(writeCount).toBe(0);
  });

  it.each([
    [['other-id', manifest.users[0]!.email]],
    [['id-0', 'other@example.test']],
  ])('refuses colliding ownership without writing', async ([pair]) => {
    ownership = [{ id: pair![0] as string, email: pair![1] as string }];
    await expect(main()).rejects.toThrow();
    expect(writeCount).toBe(0);
  });

  it('refuses a partial owned roster without writing', async () => {
    ownership = [{ id: manifest.users[0]!.id, email: manifest.users[0]!.email }];
    await expect(main()).rejects.toThrow();
    expect(writeCount).toBe(0);
  });

  it('hashes sequentially with PasswordService before dispatching one write', async () => {
    const hashing = jest.spyOn(PasswordService.prototype, 'hash');
    await main();
    expect(hashing).toHaveBeenCalledTimes(12);
    expect(writeCount).toBe(1);
    expect(applyFixture).toHaveBeenCalledTimes(1);
    expect((applyFixture as jest.Mock).mock.calls[0][0].passwordHashes).toHaveLength(12);
  });
});
