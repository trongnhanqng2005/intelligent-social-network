import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function createAuthTestKeyEnvironment(apiOrigin: string): Record<string, string> {
  const directory = resolve('.artifacts', `auth-test-keys-${process.pid}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const privatePath = resolve(directory, 'private.pem');
  const publicPath = resolve(directory, 'public.pem');
  const csrfPath = resolve(directory, 'csrf.secret');
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicKey, { mode: 0o600 });
  writeFileSync(csrfPath, randomBytes(32), { mode: 0o600 });
  process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
  return {
    AUTH_PRIVATE_KEY_PATH: privatePath,
    AUTH_PUBLIC_KEY_PATH: publicPath,
    AUTH_CSRF_SECRET_PATH: csrfPath,
    AUTH_KEY_ID: 'playwright-auth-test-key',
    AUTH_ISSUER: apiOrigin,
    AUTH_AUDIENCE: 'intelligent-social-network-web',
  };
}
