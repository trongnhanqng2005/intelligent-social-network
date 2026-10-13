import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Neo4jOperationsModule } from './neo4j-operations.module.js';
import { Neo4jSchemaService } from './neo4j-schema.service.js';

async function initializeSchema(): Promise<void> {
  const app = await NestFactory.createApplicationContext(Neo4jOperationsModule, {
    logger: false,
  });
  try {
    const result = await app.get(Neo4jSchemaService).initializeSchema();
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      'Neo4j schema initialization failed. Verify local configuration, target database, and schema privileges.',
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void initializeSchema();
