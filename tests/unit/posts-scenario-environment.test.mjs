import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPostsScenario } from '../fixtures/posts/scenario-support.mjs';

test('scenario fixture refuses execution without a guarded runner handoff', async () => {
  const previous = process.env.ISN_POSTS_SCENARIO_GATE_FILE;
  delete process.env.ISN_POSTS_SCENARIO_GATE_FILE;
  try {
    await assert.rejects(createPostsScenario({ actorCount: 2 }));
  } finally {
    if (previous !== undefined) process.env.ISN_POSTS_SCENARIO_GATE_FILE = previous;
  }
});

test('loading the scenario app preserves restricted target environment between scenarios', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const script = `
    import { loadPostsScenarioAppModule } from './tests/fixtures/posts/scenario-support.mjs';
    import { assertPostsTestTarget } from './apps/api/scripts/posts-operation-safety.mjs';
    assertPostsTestTarget(process.env);
    await loadPostsScenarioAppModule();
    assertPostsTestTarget(process.env);
    await loadPostsScenarioAppModule();
    assertPostsTestTarget(process.env);
  `;
  const env = { ...process.env, NODE_ENV: 'test', NEO4J_DATABASE: 'isn-test',
    NEO4J_URI: 'neo4j://127.0.0.1:7687', NEO4J_TEST_USERNAME: 'isn_test_runner',
    NEO4J_TEST_PASSWORD: 'synthetic-test-password', AUTH_PRIVATE_KEY_PATH: 'placeholder',
    AUTH_PUBLIC_KEY_PATH: 'placeholder', AUTH_CSRF_SECRET_PATH: 'placeholder',
    AUTH_KEY_ID: 'test', AUTH_ISSUER: 'http://localhost:3312', AUTH_AUDIENCE: 'test',
    AUTH_WEB_ORIGIN: 'http://localhost:5182' };
  delete env.NEO4J_USERNAME;
  delete env.NEO4J_PASSWORD;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { cwd: root, env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
