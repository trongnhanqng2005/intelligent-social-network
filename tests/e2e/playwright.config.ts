import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const outputDirectory = resolve(root, '.artifacts/playwright');

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(outputDirectory, 'report'), open: 'never' }],
  ],
  outputDir: resolve(outputDirectory, 'test-results'),
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: [
    {
      name: 'API',
      command: 'npm run dev:api',
      cwd: root,
      url: 'http://127.0.0.1:3301/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3301',
        NEO4J_URI: 'neo4j://127.0.0.1:1',
        NEO4J_TEST_USERNAME: 'api-e2e-test',
        NEO4J_TEST_PASSWORD: 'not-a-real-credential',
        NEO4J_DATABASE: 'isn-test',
      },
    },
    {
      name: 'Web',
      command: 'npm run dev:web',
      cwd: root,
      url: 'http://127.0.0.1:5174',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        ISN_WEB_PORT: '5174',
        VITE_API_BASE_URL: '/api',
        API_PROXY_TARGET: 'http://127.0.0.1:3301',
      },
    },
  ],
});
