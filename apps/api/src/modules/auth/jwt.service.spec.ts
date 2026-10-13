import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service.js';

describe('JwtService', () => {
  let directory: string;
  let service: JwtService;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'isn-jwt-'));
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await Promise.all([
      writeFile(join(directory, 'private.pem'), pair.privateKey),
      writeFile(join(directory, 'public.pem'), pair.publicKey),
    ]);
    const config = new ConfigService({
      AUTH_PRIVATE_KEY_PATH: join(directory, 'private.pem'),
      AUTH_PUBLIC_KEY_PATH: join(directory, 'public.pem'),
      AUTH_KEY_ID: 'test-key',
      AUTH_ISSUER: 'https://issuer.example.test',
      AUTH_AUDIENCE: 'isn-web',
    });
    service = new JwtService(config);
    await service.onModuleInit();
  });

  afterAll(async () => rm(directory, { recursive: true, force: true }));

  it('signs and verifies an RS256 session token with a fixed 24-hour lifetime', async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await service.signSession('user-1', 'session-1', issuedAt);
    const claims = await service.verifySessionToken(token);

    expect(claims).toMatchObject({ sub: 'user-1', jti: 'session-1', iat: issuedAt, exp: issuedAt + 86_400 });
  });

  it('rejects token tampering and tokens signed by an unexpected algorithm', async () => {
    const token = await service.signSession('user-1', 'session-1');
    await expect(service.verifySessionToken(`${token.slice(0, -1)}x`)).rejects.toThrow();
  });

  it('rejects an expired 24-hour token even when its signature is valid', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 86_410;
    const token = await service.signSession('user-1', 'session-1', issuedAt);
    await expect(service.verifySessionToken(token)).rejects.toThrow();
  });
});
