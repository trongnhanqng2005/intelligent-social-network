const { generateKeyPairSync, randomBytes, randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = function createEphemeralAuthKeys() {
  const root = join(__dirname, '..', '.artifacts');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'api-e2e-auth-'));
  const nonce = randomUUID();
  writeFileSync(join(directory, '.owner'), nonce, { mode: 0o600 });
  globalThis.__ISN_API_E2E_AUTH_KEYS__ = { directory, nonce };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.AUTH_PRIVATE_KEY_PATH = join(directory, 'private.pem');
  process.env.AUTH_PUBLIC_KEY_PATH = join(directory, 'public.pem');
  process.env.AUTH_CSRF_SECRET_PATH = join(directory, 'csrf.secret');
  writeFileSync(process.env.AUTH_PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(process.env.AUTH_PUBLIC_KEY_PATH, publicKey, { mode: 0o600 });
  writeFileSync(process.env.AUTH_CSRF_SECRET_PATH, randomBytes(32), { mode: 0o600 });
};
