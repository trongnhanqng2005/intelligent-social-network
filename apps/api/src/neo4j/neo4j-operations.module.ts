import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateNeo4jEnvironment } from '../config/env.validation.js';
import { Neo4jModule } from './neo4j.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateNeo4jEnvironment,
    }),
    Neo4jModule,
  ],
})
export class Neo4jOperationsModule {}
