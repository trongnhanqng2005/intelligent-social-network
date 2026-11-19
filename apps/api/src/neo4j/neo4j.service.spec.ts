import type { Driver, ManagedTransaction, Session } from 'neo4j-driver';
import { Neo4jService, Neo4jWriteOutcomeUnknownError } from './neo4j.service.js';

describe('Neo4jService', () => {
  const tx = {} as ManagedTransaction;
  let session: jest.Mocked<Session>;
  let driver: jest.Mocked<Driver>;
  let service: Neo4jService;

  beforeEach(() => {
    session = {
      executeRead: jest.fn(async (work) => work(tx)),
      executeWrite: jest.fn(async (work) => work(tx)),
      run: jest.fn(async () => ({ consume: jest.fn().mockResolvedValue(undefined) })),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Session>;
    driver = {
      session: jest.fn(() => session),
      verifyConnectivity: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Driver>;
    service = new Neo4jService(driver, 'isn-dev');
  });

  it('selects the configured database and closes a read session', async () => {
    await expect(service.executeRead(async () => 'read result')).resolves.toBe(
      'read result',
    );

    expect(driver.session).toHaveBeenCalledWith({ database: 'isn-dev' });
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('closes a write session when the transaction fails', async () => {
    session.executeWrite.mockRejectedValueOnce(new Error('transaction failed'));

    await expect(service.executeWrite(async () => undefined)).rejects.toThrow(
      'transaction failed',
    );
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('runs an explicit write callback once and commits without managed retries', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    session.beginTransaction = jest.fn().mockResolvedValue(transaction) as never;
    const work = jest.fn().mockResolvedValue('created');

    await expect(service.executeWriteOnce(work)).resolves.toBe('created');

    expect(work).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(session.executeWrite).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('rolls back a pre-commit failure and preserves its known error', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    session.beginTransaction = jest.fn().mockResolvedValue(transaction) as never;

    await expect(service.executeWriteOnce(async () => { throw new Error('rejected before commit'); }))
      .rejects.toThrow('rejected before commit');

    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('reports an ambiguous commit failure as unknown instead of a definitive write failure', async () => {
    const transaction = {
      commit: jest.fn().mockRejectedValue(new Error('connection closed')),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    session.beginTransaction = jest.fn().mockResolvedValue(transaction) as never;

    await expect(service.executeWriteOnce(async () => 'result'))
      .rejects.toBeInstanceOf(Neo4jWriteOutcomeUnknownError);

    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('runs static schema statements in the configured database and consumes them', async () => {
    session.run.mockResolvedValueOnce({ records: [], summary: {} } as never);

    await service.runSchemaStatement('CREATE CONSTRAINT ...');

    expect(driver.session).toHaveBeenCalledWith({ database: 'isn-dev' });
    expect(session.run).toHaveBeenCalledWith('CREATE CONSTRAINT ...');
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('closes the application-scoped driver during module shutdown', async () => {
    await service.onModuleDestroy();

    expect(driver.close).toHaveBeenCalledTimes(1);
  });
});
