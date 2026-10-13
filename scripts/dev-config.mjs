import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiDirectory = resolve(repositoryRoot, 'apps/api');
const webDirectory = resolve(repositoryRoot, 'apps/web');

export function validateEffectiveConfig(api, web) {
  if ((api.NODE_ENV ?? 'development') !== 'development') throw new Error('API NODE_ENV must be development.');
  if (api.NEO4J_DATABASE !== 'isn-dev') throw new Error('API NEO4J_DATABASE must be isn-dev.');
  for (const key of ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'AUTH_PRIVATE_KEY_PATH', 'AUTH_PUBLIC_KEY_PATH', 'AUTH_CSRF_SECRET_PATH', 'AUTH_KEY_ID', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_WEB_ORIGIN']) {
    if (typeof api[key] !== 'string' || !api[key].trim()) throw new Error(`Required API setting ${key} is missing.`);
  }

  const apiPort = readPort(api.PORT, 'API PORT', 3000);
  const apiHost = api.HOST?.trim() || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::', '::1'].includes(apiHost)) {
    throw new Error('API HOST must be a local address for the development launcher.');
  }
  const webPort = readPort(web.ISN_WEB_PORT, 'ISN_WEB_PORT', 5173);
  if (apiPort === webPort) throw new Error('API PORT and ISN_WEB_PORT must be different.');
  if (web.VITE_API_BASE_URL && web.VITE_API_BASE_URL.trim().replace(/\/+$/, '') !== '/api') {
    throw new Error('VITE_API_BASE_URL must use the local /api proxy for the development launcher.');
  }
  const webOrigin = parseOrigin(api.AUTH_WEB_ORIGIN);
  if (!['127.0.0.1', 'localhost'].includes(webOrigin.hostname) || Number(webOrigin.port || 80) !== webPort || webOrigin.protocol !== 'http:') {
    throw new Error('AUTH_WEB_ORIGIN must match the local Vite URL and configured web port.');
  }

  const apiProxyTarget = web.API_PROXY_TARGET || 'http://127.0.0.1:3000';
  let proxy;
  try { proxy = new URL(apiProxyTarget); } catch { throw new Error('API_PROXY_TARGET must be a valid local HTTP URL.'); }
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
  const proxyHost = proxy.hostname.replace(/^\[|\]$/g, '');
  const localApiHosts = apiHost === '0.0.0.0' || apiHost === '::'
    ? ['127.0.0.1', 'localhost', '::1']
    : [apiHost, ...(apiHost === '127.0.0.1' ? ['localhost'] : [])];
  if (proxy.protocol !== 'http:' || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash || !localApiHosts.includes(proxyHost) || proxyPort !== apiPort) {
    throw new Error('API_PROXY_TARGET must point to the configured local API host and port.');
  }
  const probeHost = ['0.0.0.0', '::'].includes(apiHost) ? '127.0.0.1' : apiHost;

  let neo4j;
  try { neo4j = new URL(api.NEO4J_URI); } catch { throw new Error('NEO4J_URI must be a valid Neo4j driver URI.'); }
  if (!['neo4j:', 'neo4j+s:', 'neo4j+ssc:', 'bolt:', 'bolt+s:', 'bolt+ssc:'].includes(neo4j.protocol) || !neo4j.hostname || neo4j.username || neo4j.password) {
    throw new Error('NEO4J_URI must be a supported driver URI without embedded credentials.');
  }
  let issuer;
  try { issuer = new URL(api.AUTH_ISSUER); } catch { throw new Error('AUTH_ISSUER must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(issuer.protocol) || issuer.username || issuer.password) {
    throw new Error('AUTH_ISSUER must be a valid HTTP(S) URL.');
  }
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(api.AUTH_KEY_ID)) throw new Error('AUTH_KEY_ID must use URL-safe identifier characters.');
  if (api.AUTH_AUDIENCE.length > 256) throw new Error('AUTH_AUDIENCE must be at most 256 characters.');

  return {
    apiHost,
    apiPort,
    apiProbeUrl: `http://${formatHost(probeHost)}:${apiPort}/ready`,
    apiProxyTarget: apiProxyTarget.replace(/\/$/, ''),
    webPort,
    webUrl: webOrigin.origin,
    database: 'isn-dev',
  };
}

function readPort(value, name, fallback) {
  const port = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be an integer between 1 and 65535.`);
  return port;
}

function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Configured authentication origin is not a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
    throw new Error('Configured authentication origin must be a valid HTTP(S) origin.');
  }
  return url;
}

function formatHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

async function readDotEnv(path, name) {
  try { return parseEnv(await readFile(path, 'utf8')); }
  catch { throw new Error(`Missing or unreadable ${name}: ${path}`); }
}

async function validateKeyMaterial(api) {
  const authPath = (value) => isAbsolute(value) ? value : resolve(apiDirectory, value);
  const privatePath = authPath(api.AUTH_PRIVATE_KEY_PATH);
  const publicPath = authPath(api.AUTH_PUBLIC_KEY_PATH);
  const csrfPath = authPath(api.AUTH_CSRF_SECRET_PATH);
  try {
    const privateBytes = await readFile(privatePath);
    const publicBytes = await readFile(publicPath);
    const csrfBytes = await readFile(csrfPath);
    if (csrfBytes.byteLength < 32) throw new Error();
    const privateKey = createPrivateKey(privateBytes);
    const publicKey = createPublicKey(publicBytes);
    if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
        publicKey.asymmetricKeyType !== 'rsa' || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw new Error();
    const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const configured = publicKey.export({ type: 'spki', format: 'der' });
    if (!derived.equals(configured)) throw new Error();
  } catch {
    throw new Error('Authentication signing keys/CSRF secret are missing or invalid; signing keys must be a matching RSA-3072-or-stronger pair and the CSRF secret at least 32 bytes. The launcher does not modify them.');
  }
}

async function main() {
  const apiFile = resolve(apiDirectory, '.env');
  const webFile = resolve(webDirectory, '.env');
  const api = { ...await readDotEnv(apiFile, 'apps/api/.env'), ...process.env };
  const webFileValues = await stat(webFile).then(() => readDotEnv(webFile, 'apps/web/.env')).catch((error) => {
    if (error?.code === 'ENOENT') return {};
    throw error;
  });
  const web = { ...webFileValues, ...process.env };
  const config = validateEffectiveConfig(api, web);
  await validateKeyMaterial(api);
  await stat(resolve(repositoryRoot, 'node_modules/.bin/nest.cmd'));
  await stat(resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'));
  if (process.argv.includes('--json')) console.log(JSON.stringify(config));
  else {
    console.log(`Configuration ready: API ${config.apiProbeUrl}, web ${config.webUrl}, Neo4j database ${config.database}.`);
    console.log('Authentication configuration and key files are present; secret values were not displayed.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
