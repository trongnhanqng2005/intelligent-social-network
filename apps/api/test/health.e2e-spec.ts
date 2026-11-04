import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Neo4jSchemaService } from '../src/neo4j/neo4j-schema.service.js';
import { Neo4jMigrationService } from '../src/neo4j/neo4j-migrations.js';
import { Neo4jService } from '../src/neo4j/neo4j.service.js';
import { ReadinessController } from '../src/modules/health/readiness.controller.js';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns HTTP 200 and the exact liveness payload', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({ status: 'ok' });
  });
});

describe('GET /ready', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a sanitized unavailable response when Neo4j cannot be reached', async () => {
    await request(app.getHttpServer())
      .get('/ready')
      .expect(503)
      .expect({
        status: 'not_ready',
        database: 'isn-test',
        reason: 'DATABASE_UNAVAILABLE',
      });
  });
});

describe('GET /ready with an incomplete V5 schema (isolated)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const neo4j = {
      database: 'isn-test',
      verifyConnectivity: jest.fn().mockResolvedValue(undefined),
    } as unknown as Neo4jService;
    const migrations = {
      getStatus: jest.fn().mockResolvedValue({
        database: 'isn-test', status: 'incomplete', version: 4, migrations: [],
      }),
    } as unknown as Neo4jMigrationService;
    const schemaService = new Neo4jSchemaService(neo4j, migrations);
    const moduleRef = await Test.createTestingModule({
      controllers: [ReadinessController],
      providers: [{ provide: Neo4jSchemaService, useValue: schemaService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns HTTP 503 and the V5 migration-incomplete reason without accessing Neo4j', async () => {
    await request(app.getHttpServer())
      .get('/ready')
      .expect(503)
      .expect({
        status: 'not_ready',
        database: 'isn-test',
        reason: 'SCHEMA_MIGRATION_INCOMPLETE',
        expectedSchemaVersion: 5,
        actualSchemaVersion: 4,
      });
  });
});
