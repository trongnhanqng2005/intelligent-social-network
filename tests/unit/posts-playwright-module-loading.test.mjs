import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Posts config and native scenario imports coexist in the Playwright loader without DB access', async () => {
  const directory = await mkdtemp(resolve(process.platform === 'win32' ? 'D:/temp/opencode' : tmpdir(), 'posts-module-smoke-'));
  try {
    const listSource = await readFile(resolve(root, 'tests/e2e/posts-scenario-list.mjs'), 'utf8');
    const configPath = listSource.match(/'tests\/e2e\/posts\.playwright\.config\.[cm]?ts'/u)?.[0].slice(1, -1);
    assert.ok(configPath);
    const configUrl = pathToFileURL(resolve(root, configPath)).href;
    const supportUrl = pathToFileURL(resolve(root, 'tests/fixtures/posts/scenario-support.mjs')).href;
    const playwrightUrl = pathToFileURL(resolve(root, 'node_modules/@playwright/test/index.mjs')).href;
    await writeFile(resolve(directory, 'playwright.config.mts'), `
import config from ${JSON.stringify(configUrl)};
export default { ...config, testDir: ${JSON.stringify(directory)}, testMatch: 'module-load.spec.mts' };
`);
    await writeFile(resolve(directory, 'module-load.spec.mts'), `
import { test, expect } from ${JSON.stringify(playwrightUrl)};
const support = await import(${JSON.stringify(supportUrl)});
expect(typeof support.createPostsScenario).toBe('function');
expect(typeof support.cleanupPostsScenario).toBe('function');
test('module loading only; no fixture or database call', () => {});
`);
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'),
      'test', '--list', '--config', resolve(directory, 'playwright.config.mts')], {
      cwd: root,
      env: { ...process.env, ISN_POSTS_SCENARIO_DISCOVERY: '1' },
      encoding: 'utf8', timeout: 30_000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Total: 1 test/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
