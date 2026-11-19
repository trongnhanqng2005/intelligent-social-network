import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: './specs', testMatch: 'posts-session-regression.case.mts',
  workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5199', browserName: 'chromium', headless: true },
  webServer: { command: 'npm run dev:web', cwd: root, url: 'http://127.0.0.1:5199',
    reuseExistingServer: false, timeout: 120_000,
    env: { ISN_WEB_PORT: '5199', VITE_API_BASE_URL: '/api', API_PROXY_TARGET: 'http://127.0.0.1:1' } },
});
