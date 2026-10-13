import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { NEO4J_DATABASE, NEO4J_DRIVER } from './neo4j.constants.js';
import { Neo4jService } from './neo4j.service.js';
import { Neo4jSchemaService } from './neo4j-schema.service.js';
import { Neo4jMigrationService } from './neo4j-migrations.js';

@Module({
  providers: [
    {
      provide: NEO4J_DATABASE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.getOrThrow<string>('NEO4J_DATABASE'),
    },
    {
      provide: NEO4J_DRIVER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        neo4j.driver(
          configService.getOrThrow<string>('NEO4J_URI'),
          neo4j.auth.basic(
            configService.getOrThrow<string>('NEO4J_USERNAME'),
            configService.getOrThrow<string>('NEO4J_PASSWORD'),
          ),
          {
            connectionTimeout: 5_000,
            maxTransactionRetryTime: 1_000,
          },
        ),
    },
    Neo4jService,
    Neo4jMigrationService,
    Neo4jSchemaService,
  ],
  exports: [Neo4jService, Neo4jSchemaService, Neo4jMigrationService],
})
export class Neo4jModule {}
