import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDirectory = path.join(root, 'apps', 'api');
const webDirectory = path.join(root, 'apps', 'web');
const node = process.execPath;

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert(address && typeof address !== 'string');
  return address.port;
}

function start(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  return {
    child,
    get output() {
      return output;
    },
  };
}

async function waitForResponse(url, processHandles) {
  const deadline = Date.now() + 20_000;
  let lastError;
  let lastStatus;

  while (Date.now() < deadline) {
    for (const handle of processHandles) {
      if (handle.child.exitCode !== null) {
        throw new Error(`Server exited early. Output:\n${handle.output}`);
      }
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
      lastStatus = response.status;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }

  const logs = processHandles.map(({ output }) => output).join('\n');
  throw new Error(
    `Timed out waiting for ${url} (last status: ${lastStatus}; ${lastError}).\n${logs}`,
  );
}

async function stop(handle) {
  if (handle.child.exitCode !== null) return;
  const exited = once(handle.child, 'exit');
  handle.child.kill();
  await Promise.race([exited, delay(3_000)]);
}

test('the running Vite development proxy returns the API health contract', async (t) => {
  const apiPort = await availablePort();
  const webPort = await availablePort();
  await mkdir(path.join(root, '.artifacts'), { recursive: true });
  const authKeyDirectory = await mkdtemp(path.join(root, '.artifacts', 'api-proxy-auth-keys-'));
  const keyPair = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const privateKeyPath = path.join(authKeyDirectory, 'private.pem');
  const publicKeyPath = path.join(authKeyDirectory, 'public.pem');
  const csrfSecretPath = path.join(authKeyDirectory, 'csrf.secret');
  await Promise.all([
    writeFile(privateKeyPath, keyPair.privateKey, { mode: 0o600 }),
    writeFile(publicKeyPath, keyPair.publicKey, { mode: 0o600 }),
    writeFile(csrfSecretPath, randomBytes(32), { mode: 0o600 }),
  ]);
  const api = start(node, ['dist/main.js'], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      NEO4J_URI: 'neo4j://127.0.0.1:1',
      NEO4J_TEST_USERNAME: 'api-proxy-test',
      NEO4J_TEST_PASSWORD: 'not-a-real-credential',
      NEO4J_DATABASE: 'isn-test',
      AUTH_PRIVATE_KEY_PATH: privateKeyPath,
      AUTH_PUBLIC_KEY_PATH: publicKeyPath,
      AUTH_CSRF_SECRET_PATH: csrfSecretPath,
      AUTH_KEY_ID: 'api-proxy-test-key',
      AUTH_ISSUER: `http://127.0.0.1:${apiPort}`,
      AUTH_AUDIENCE: 'intelligent-social-network-web',
      AUTH_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    },
  });
  const web = start(
    node,
    [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_API_BASE_URL: '/api',
        API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  );

  t.after(async () => {
    await stop(web);
    await stop(api);
    await rm(authKeyDirectory, { recursive: true, force: true });
  });

  const response = await waitForResponse(
    `http://127.0.0.1:${webPort}/api/health`,
    [api, web],
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
