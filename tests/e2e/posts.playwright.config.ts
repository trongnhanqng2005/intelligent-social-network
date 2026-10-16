import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { relative, resolve, sep } from 'node:path';
import { assertPostsScenarioRunnerHandoff } from '../fixtures/posts/scenario-runner.mjs';

const root = resolve(__dirname, '../..');
const gateFile = process.env.ISN_POSTS_SCENARIO_GATE_FILE;
let marker: unknown;

if (gateFile) {
  const gateDirectory = resolve(root, '.artifacts/playwright/posts/run-control');
  const resolvedGateFile = resolve(gateFile);
  const relativeGateFile = relative(gateDirectory, resolvedGateFile);
  if (!relativeGateFile || relativeGateFile.startsWith(`..${sep}`) || relativeGateFile === '..') {
    throw new Error('Posts E2E runner handoff is invalid.');
  }
  try { marker = JSON.parse(readFileSync(resolvedGateFile, 'utf8')); }
  catch { marker = undefined; }
}

const markerRunnerPid = typeof marker === 'object' && marker !== null && 'runnerPid' in marker
  ? marker.runnerPid : undefined;
let runnerActive = false;
if (typeof markerRunnerPid === 'number' && Number.isSafeInteger(markerRunnerPid)) {
  try { process.kill(markerRunnerPid, 0); runnerActive = true; }
  catch { runnerActive = false; }
}

const invocation = assertPostsScenarioRunnerHandoff({
  environment: process.env,
  marker,
  parentPid: process.ppid,
  runnerActive,
  argv: process.argv,
});
if (invocation === 'denied') throw new Error('Use the guarded Posts scenario runner; direct Playwright execution is denied.');

export default defineConfig({
  testDir: './specs',
  testMatch: 'posts-feed.spec.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: resolve(root, '.artifacts/playwright/posts',
    typeof marker === 'object' && marker !== null && 'runId' in marker && typeof marker.runId === 'string'
      ? marker.runId : 'discovery-results',
    'test-results'),
  use: {
    baseURL: 'http://127.0.0.1:5182',
    browserName: 'chromium',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{
    name: 'posts-desktop-chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  }],
});
