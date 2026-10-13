import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type {
  Driver,
  ManagedTransaction,
  Session,
} from 'neo4j-driver';
import { NEO4J_DATABASE, NEO4J_DRIVER } from './neo4j.constants.js';

@Injectable()
export class Neo4jService implements OnModuleDestroy {
  constructor(
    @Inject(NEO4J_DRIVER) private readonly driver: Driver,
    @Inject(NEO4J_DATABASE) readonly database: string,
  ) {}

  async verifyConnectivity(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  async executeRead<T>(
    work: (transaction: ManagedTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withSession((session) => session.executeRead(work));
  }

  async executeWrite<T>(
    work: (transaction: ManagedTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withSession((session) => session.executeWrite(work));
  }

  async runSchemaStatement(statement: string): Promise<void> {
    await this.withSession(async (session) => {
      await session.run(statement);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver.close();
  }

  private async withSession<T>(work: (session: Session) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database });
    try {
      return await work(session);
    } finally {
      await session.close();
    }
  }
}
