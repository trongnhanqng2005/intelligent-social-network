import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertPostsWorktreeRoot, assertPostsWriteWindow } from './posts-operation-safety.mjs';

const root = resolve('.');
assertPostsWriteWindow();
assertPostsWorktreeRoot(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(),
  root,
);
assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), 'feature/posts-feed');
execFileSync('git', ['merge-base', '--is-ancestor', '07b9b385321716a514ecef99ff0184e8f903fac2', 'HEAD'], {
  cwd: root,
  stdio: 'ignore',
});
assert.equal(process.argv.length, 2, 'This wrapper applies only the already reviewed migration command.');

const result = spawnSync(process.execPath, [resolve(root, 'apps/api/dist/neo4j/migrate.js'), 'apply'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw new Error('Could not start the explicit isn-test migration command.');
process.exitCode = result.status ?? 1;
