import type { ManagedTransaction, Transaction } from 'neo4j-driver';
import { Neo4jService } from '../neo4j/neo4j.service.js';

/** Routes nested domain repository calls into the caller-owned transaction. */
export class TransactionNeo4jService extends Neo4jService {
  constructor(driver: import('neo4j-driver').Driver, database: string, private readonly transaction: Transaction) {
    super(driver, database);
  }

  override executeRead<T>(work: (transaction: ManagedTransaction) => Promise<T>): Promise<T> {
    return work(this.transaction as unknown as ManagedTransaction);
  }

  override executeWrite<T>(work: (transaction: ManagedTransaction) => Promise<T>): Promise<T> {
    return work(this.transaction as unknown as ManagedTransaction);
  }

  override executeWriteOnce<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return work(this.transaction);
  }
}
