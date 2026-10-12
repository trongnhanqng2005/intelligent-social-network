import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

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
