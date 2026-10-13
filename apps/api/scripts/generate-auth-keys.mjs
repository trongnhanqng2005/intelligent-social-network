import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.local/auth');
await mkdir(directory, { recursive: true, mode: 0o700 });
const privateKeyPath = resolve(directory, 'private.pem');
const publicKeyPath = resolve(directory, 'public.pem');
const csrfSecretPath = resolve(directory, 'csrf.secret');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

try {
  await writeFile(privateKeyPath, privateKey, { flag: 'wx', mode: 0o600 });
  await writeFile(publicKeyPath, publicKey, { flag: 'wx', mode: 0o600 });
  await writeFile(csrfSecretPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  for (const path of [privateKeyPath, publicKeyPath, csrfSecretPath]) {
    await chmod(path, 0o600).catch(() => undefined);
  }
} catch (error) {
  console.error('Authentication key generation stopped; inspect the local auth directory before retrying. Existing files were not overwritten.');
  process.exitCode = 1;
  throw error;
}

console.log('Generated local RSA-3072 and CSRF key files (secrets not printed).');
console.log(`AUTH_PRIVATE_KEY_PATH=${privateKeyPath}`);
console.log(`AUTH_PUBLIC_KEY_PATH=${publicKeyPath}`);
console.log(`AUTH_CSRF_SECRET_PATH=${csrfSecretPath}`);
console.log('Set AUTH_KEY_ID, AUTH_ISSUER, AUTH_AUDIENCE and AUTH_WEB_ORIGIN in the ignored API environment file.');
