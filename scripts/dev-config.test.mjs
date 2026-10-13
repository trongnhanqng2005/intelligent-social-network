import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEffectiveConfig } from './dev-config.mjs';

const api = {
  NODE_ENV: 'development', PORT: '3000', HOST: '127.0.0.1', NEO4J_DATABASE: 'isn-dev',
  NEO4J_URI: 'neo4j://127.0.0.1:7687', NEO4J_USERNAME: 'user', NEO4J_PASSWORD: 'secret',
  AUTH_PRIVATE_KEY_PATH: '.local/auth/private.pem', AUTH_PUBLIC_KEY_PATH: '.local/auth/public.pem',
  AUTH_CSRF_SECRET_PATH: '.local/auth/csrf.secret', AUTH_KEY_ID: 'local-rsa-1',
  AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_AUDIENCE: 'local-web', AUTH_WEB_ORIGIN: 'http://127.0.0.1:5173',
};

test('resolves repository development defaults without returning secrets', () => {
  const config = validateEffectiveConfig(api, {});
  assert.equal(config.apiProbeUrl, 'http://127.0.0.1:3000/ready');
  assert.equal(config.webUrl, 'http://127.0.0.1:5173');
  assert.equal('NEO4J_PASSWORD' in config, false);
});

test('respects configured API and Vite ports and proxy target', () => {
  const config = validateEffectiveConfig({ ...api, PORT: '3300', AUTH_WEB_ORIGIN: 'http://localhost:5180' }, {
    ISN_WEB_PORT: '5180', API_PROXY_TARGET: 'http://localhost:3300',
  });
  assert.equal(config.apiProbeUrl, 'http://127.0.0.1:3300/ready');
  assert.equal(config.apiProxyTarget, 'http://localhost:3300');
  assert.equal(config.webUrl, 'http://localhost:5180');
});

test('rejects non-development database targets and mismatched proxy ports', () => {
  assert.throws(() => validateEffectiveConfig({ ...api, NEO4J_DATABASE: 'isn-test' }, {}), /isn-dev/);
  assert.throws(() => validateEffectiveConfig(api, { API_PROXY_TARGET: 'http://127.0.0.1:3001' }), /API_PROXY_TARGET/);
});

test('rejects missing authentication configuration without printing its value', () => {
  assert.throws(() => validateEffectiveConfig({ ...api, AUTH_WEB_ORIGIN: undefined }, {}), /AUTH_WEB_ORIGIN/);
});

test('rejects a frontend API base that bypasses the local Vite proxy', () => {
  assert.throws(() => validateEffectiveConfig(api, { VITE_API_BASE_URL: 'https://example.invalid/api' }), /VITE_API_BASE_URL/);
});

test('rejects identical API and web ports', () => {
  assert.throws(() => validateEffectiveConfig({ ...api, PORT: '5173' }, {}), /must be different/);
});
