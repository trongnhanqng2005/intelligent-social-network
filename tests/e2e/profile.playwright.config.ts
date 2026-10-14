import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { createAuthTestKeyEnvironment } from './auth-test-keys';

const root = resolve(__dirname, '../..');
const apiOrigin = 'http://127.0.0.1:3305';
const webOrigin = 'http://127.0.0.1:5178';
const neo4jUri = process.env.NEO4J_URI;
const username = process.env.NEO4J_TEST_USERNAME;
const password = process.env.NEO4J_TEST_PASSWORD;

if (!neo4jUri || !username || !password || process.env.NEO4J_DATABASE !== 'isn-test' ||
    process.env.NODE_ENV !== 'test') {
  throw new Error('Profile acceptance requires NODE_ENV=test, dedicated isn-test credentials, and the test database.');
}
if (process.env.NEO4J_USERNAME || process.env.NEO4J_PASSWORD) {
  throw new Error('Profile acceptance refuses development administrator credentials.');
}

const authEnvironment = createAuthTestKeyEnvironment(apiOrigin);

export default defineConfig({
  testDir: './specs',
  testMatch: 'user-profile-discovery.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: resolve(root, '.artifacts/playwright/profile-report'), open: 'never' }]],
  outputDir: resolve(root, '.artifacts/playwright/profile-results'),
  use: {
    baseURL: webOrigin,
    browserName: 'chromium',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'off',
    trace: 'off',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'profile-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      name: 'Profile Acceptance API (isn-test)',
      command: 'npm run dev:api',
      cwd: root,
      url: `${apiOrigin}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3305',
        NEO4J_URI: neo4jUri, NEO4J_DATABASE: 'isn-test',
        NEO4J_TEST_USERNAME: username, NEO4J_TEST_PASSWORD: password,
        NEO4J_USERNAME: '', NEO4J_PASSWORD: '', AUTH_WEB_ORIGIN: webOrigin,
        ...authEnvironment,
      },
    },
    {
      name: 'Profile Acceptance Web',
      command: 'npm run dev:web',
      cwd: root,
      url: webOrigin,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development', ISN_WEB_PORT: '5178', VITE_API_BASE_URL: '/api',
        API_PROXY_TARGET: apiOrigin,
      },
    },
  ],
});
