import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns the exact process-liveness response', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    expect(moduleRef.get(HealthController).getHealth()).toEqual({
      status: 'ok',
    });

    await moduleRef.close();
  });
});
