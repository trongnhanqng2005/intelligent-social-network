import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
const config = resolve(root, 'tests/e2e/posts.playwright.config.ts');
const result = spawnSync(process.execPath, [cli, 'test', '--list', '--config', config], {
  cwd: root,
  env: { ...process.env, ISN_POSTS_SCENARIO_DISCOVERY: '1' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
