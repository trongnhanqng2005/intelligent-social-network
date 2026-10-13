import type { Driver, ManagedTransaction, Session } from 'neo4j-driver';
import { Neo4jService } from './neo4j.service.js';

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
