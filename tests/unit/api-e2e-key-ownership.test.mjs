import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import teardown from '../../apps/api/test/jest-e2e.teardown.cjs';
import setup from '../../apps/api/test/jest-e2e.global-setup.cjs';

test('API E2E teardown removes only its invocation-owned keys', async () => {
  const root = resolve('apps/api/.artifacts');
  const owned = resolve(root, `api-e2e-auth-${Date.now()}`);
  const other = resolve(root, `api-e2e-auth-${Date.now() + 1}`);
  const nonce = randomUUID();
  await mkdir(owned, { recursive: true });
  await mkdir(other, { recursive: true });
  await writeFile(resolve(owned, '.owner'), nonce);
  await writeFile(resolve(other, 'private.pem'), 'other invocation sentinel');
  globalThis.__ISN_API_E2E_AUTH_KEYS__ = { directory: owned, nonce };
  try {
    await teardown();
    assert.equal(await readFile(resolve(other, 'private.pem'), 'utf8'), 'other invocation sentinel');
    await assert.rejects(readFile(resolve(owned, '.owner')), { code: 'ENOENT' });
  } finally {
    delete globalThis.__ISN_API_E2E_AUTH_KEYS__;
    await rm(owned, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test('API E2E setup allocates independent invocations and teardown rejects a wrong owner', async () => {
  const names = ['AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH'];
  const saved = names.map((name) => process.env[name]);
  const invocations = [];
  try {
    setup();
    invocations.push(globalThis.__ISN_API_E2E_AUTH_KEYS__);
    setup();
    invocations.push(globalThis.__ISN_API_E2E_AUTH_KEYS__);
    assert.notEqual(invocations[0].directory, invocations[1].directory);
    assert.notEqual(invocations[0].nonce, invocations[1].nonce);
    globalThis.__ISN_API_E2E_AUTH_KEYS__ = { ...invocations[1], nonce: 'wrong-owner' };
    await assert.rejects(teardown(), /Refusing to remove unowned/);
    assert.equal(await readFile(resolve(invocations[1].directory, '.owner'), 'utf8'), invocations[1].nonce);
    globalThis.__ISN_API_E2E_AUTH_KEYS__ = invocations[1];
    await teardown();
    assert.equal(await readFile(resolve(invocations[0].directory, '.owner'), 'utf8'), invocations[0].nonce);
    globalThis.__ISN_API_E2E_AUTH_KEYS__ = invocations[0];
    await teardown();
  } finally {
    for (const owned of invocations) await rm(owned.directory, { recursive: true, force: true });
    delete globalThis.__ISN_API_E2E_AUTH_KEYS__;
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});
