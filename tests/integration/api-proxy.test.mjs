import assert from 'node:assert/strict';
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
  const api = start(node, ['dist/main.js'], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
    },
  });
  const web = start(
    node,
    [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
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
  });

  const response = await waitForResponse(
    'http://127.0.0.1:5173/api/health',
    [api, web],
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
