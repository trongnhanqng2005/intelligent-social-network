import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import {
  assertPostsScenarioExecutionTarget,
  assertPostsScenarioRunnerHandoff,
  getPostsScenarioOwnedPids,
  capturePostsScenarioOutput,
  sanitizePostsScenarioFailure,
  summarizePostsPlaywrightReport,
  runPostsScenario,
} from '../fixtures/posts/scenario-runner.mjs';

test('a rejected safety preflight cannot prepare credentials, start services, or run fixture scenarios', async () => {
  const calls = [];

  await assert.rejects(runPostsScenario({
    preflight: async () => { calls.push('preflight'); throw new Error('write window is not approved'); },
    prepare: async () => calls.push('prepare'),
    start: async () => calls.push('start'),
    run: async () => calls.push('run'),
    stop: async () => calls.push('stop'),
    dispose: async () => calls.push('dispose'),
  }), /write window is not approved/u);

  assert.deepEqual(calls, ['preflight']);
});

test('partial runtime startup is stopped and its invocation-owned resources are disposed', async () => {
  const calls = [];

  await assert.rejects(runPostsScenario({
    preflight: async () => { calls.push('preflight'); return { databaseId: 'expected' }; },
    prepare: async () => calls.push('prepare'),
    start: async () => { calls.push('start'); throw new Error('web startup failed'); },
    run: async () => calls.push('run'),
    stop: async () => calls.push('stop'),
    dispose: async () => calls.push('dispose'),
  }), /web startup failed/u);

  assert.deepEqual(calls, ['preflight', 'prepare', 'start', 'stop', 'dispose']);
});

test('failed shutdown preserves invocation-owned credentials and handoff for recovery', async () => {
  const calls = [];

  await assert.rejects(runPostsScenario({
    preflight: async () => ({ databaseId: 'expected' }),
    prepare: async () => calls.push('prepare'),
    start: async () => calls.push('start'),
    run: async () => { throw new Error('scenario failed'); },
    stop: async () => { calls.push('stop'); throw new Error('service still running'); },
    dispose: async () => calls.push('dispose'),
  }), AggregateError);

  assert.deepEqual(calls, ['prepare', 'start', 'stop']);
});

test('successful runtime lifecycle is strictly ordered after preflight and always cleaned up', async () => {
  const calls = [];

  await runPostsScenario({
    preflight: async () => { calls.push('preflight'); return { databaseId: 'expected' }; },
    prepare: async () => calls.push('prepare'),
    start: async () => calls.push('start'),
    run: async () => { calls.push('run'); return 7; },
    stop: async () => calls.push('stop'),
    dispose: async () => calls.push('dispose'),
  }).then((value) => assert.equal(value, 7));

  assert.deepEqual(calls, ['preflight', 'prepare', 'start', 'run', 'stop', 'dispose']);
});

test('direct Playwright invocation is denied without a live runner handoff; discovery is list-only', () => {
  assert.equal(assertPostsScenarioRunnerHandoff({
    environment: {}, argv: ['playwright', 'test'], parentPid: 10, now: 1,
  }), 'denied');

  assert.equal(assertPostsScenarioRunnerHandoff({
    environment: { ISN_POSTS_SCENARIO_DISCOVERY: '1' },
    argv: ['playwright', 'test', '--list'], parentPid: 10, now: 1,
  }), 'discovery');
  assert.equal(assertPostsScenarioRunnerHandoff({
    environment: { ISN_POSTS_SCENARIO_DISCOVERY: '1' },
    argv: ['playwright', 'test'], parentPid: 10, now: 1,
  }), 'denied');
});

test('Playwright accepts only an unexpired handoff owned by its invoking runner process', () => {
  const marker = {
    tokenHash: createHash('sha256').update('ephemeral-token').digest('hex'),
    runnerPid: 42,
    expiresAt: 10_000,
    databaseId: '336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786',
  };
  const environment = {
    ISN_POSTS_SCENARIO_RUNNER_TOKEN: 'ephemeral-token',
    ISN_POSTS_SCENARIO_DATABASE_ID: marker.databaseId,
  };

  assert.equal(assertPostsScenarioRunnerHandoff({ environment, marker, parentPid: 42, now: 9_000 }), 'run');
  assert.equal(assertPostsScenarioRunnerHandoff({ environment, marker, parentPid: 43, runnerActive: true, now: 9_000 }), 'run');
  assert.equal(assertPostsScenarioRunnerHandoff({ environment, marker, parentPid: 41, now: 9_000 }), 'denied');
  assert.equal(assertPostsScenarioRunnerHandoff({ environment, marker, parentPid: 43, now: 9_000 }), 'denied');
  assert.equal(assertPostsScenarioRunnerHandoff({ environment, marker, parentPid: 42, now: 10_000 }), 'denied');
  assert.equal(assertPostsScenarioRunnerHandoff({
    environment: { ...environment, ISN_POSTS_SCENARIO_RUNNER_TOKEN: 'wrong' },
    marker, parentPid: 42, now: 9_000,
  }), 'denied');
});

test('Playwright report summary retains failure location while redacting synthetic secrets', () => {
  const report = summarizePostsPlaywrightReport({
    stats: { expected: 0, skipped: 0, unexpected: 1, flaky: 0 },
    suites: [{
      specs: [{
        title: 'PF-01 synthetic auth scenario',
        tests: [{ status: 'unexpected', results: [{
          errors: ['Error: login failed for profile-123@example.invalid with password Weylume-Scenario-synthetic-fixture-alpha! csrf=csrf-secret\nReceived: 422'],
          errorLocation: { file: 'tests/e2e/specs/posts-feed.spec.ts', line: 88, column: 7 },
        }] }],
      }],
      suites: [],
    }],
  });

  assert.deepEqual(report.stats, { expected: 0, skipped: 0, unexpected: 1, flaky: 0 });
  assert.deepEqual(report.tests, [{
    title: 'PF-01 synthetic auth scenario',
    status: 'unexpected',
    failure: 'Error: login failed for [synthetic-email] with password [synthetic-password] csrf=[redacted] | Received: 422',
    location: { file: 'tests/e2e/specs/posts-feed.spec.ts', line: 88, column: 7 },
  }]);
});

test('an empty or structurally incomplete Playwright report cannot be summarized as a passing run', () => {
  assert.throws(() => summarizePostsPlaywrightReport({
    stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 }, suites: [],
  }), /no completed tests/u);
  assert.throws(() => summarizePostsPlaywrightReport({
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 }, suites: [],
  }), /test count does not match report statistics/u);
});

test('invocation child diagnostics keep only a bounded tail for stdout and stderr', () => {
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  const readOutput = capturePostsScenarioOutput(child, 16);
  child.stdout.write('abcdefghijklmnopqrst');
  child.stderr.write('safe!\nsecret-tail');

  assert.deepEqual(readOutput(), { stdout: 'efghijklmnopqrst', stderr: 'afe!\nsecret-tail' });
  child.stdout.end();
  child.stderr.end();
});

test('resource monitoring receives service and Playwright child PIDs only', () => {
  assert.deepEqual(getPostsScenarioOwnedPids([
    { pid: 12 }, { pid: undefined }, { pid: 0 },
  ], 34), [12, 34]);
  assert.deepEqual(getPostsScenarioOwnedPids([], undefined), []);
});

test('runner failure details redact synthetic credentials and tokens', () => {
  assert.equal(sanitizePostsScenarioFailure(
    'login failed profile-123@example.invalid Weylume-Scenario-synthetic-fixture-alpha! authorization: BearerSecret eyJabc.def.ghi',
  ), 'login failed [synthetic-email] [synthetic-password] authorization: [redacted] [token]');
});

test('execution refuses missing exclusive-window approval, wrong worktree, branch, or baseline before preflight', () => {
  const environment = {
    NODE_ENV: 'test',
    NEO4J_DATABASE: 'isn-test',
    NEO4J_TEST_USERNAME: 'isn_test_runner',
    NEO4J_TEST_PASSWORD: 'synthetic',
    NEO4J_URI: 'neo4j://127.0.0.1:7687',
    ISN_TEST_WRITE_WINDOW: 'owner-approved',
    ISN_B_WORKLOAD_CLEAR: 'confirmed',
  };
  const valid = {
    environment,
    cwd: 'D:\\work\\posts-feed',
    repositoryRoot: 'D:\\work\\posts-feed',
    branch: 'feature/posts-feed',
    baselineAncestor: true,
  };

  assert.equal(assertPostsScenarioExecutionTarget(valid), true);
  assert.throws(() => assertPostsScenarioExecutionTarget({
    ...valid, environment: { ...environment, ISN_TEST_WRITE_WINDOW: undefined },
  }));
  assert.throws(() => assertPostsScenarioExecutionTarget({
    ...valid, environment: { ...environment, ISN_B_WORKLOAD_CLEAR: undefined },
  }));
  assert.throws(() => assertPostsScenarioExecutionTarget({ ...valid, cwd: 'D:\\work\\other' }));
  assert.throws(() => assertPostsScenarioExecutionTarget({ ...valid, branch: 'main' }));
  assert.throws(() => assertPostsScenarioExecutionTarget({ ...valid, baselineAncestor: false }));
  assert.throws(() => assertPostsScenarioExecutionTarget({
    ...valid, environment: { ...environment, NEO4J_USERNAME: 'admin' },
  }));
});

test('direct runner refusal cannot create auth keys, fixture manifests, or launch either service', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const artifactRoot = resolve(root, '.artifacts');
  const runner = resolve(root, 'tests/e2e/posts-acceptance-runner.mjs');
  const before = readArtifactNames(artifactRoot);
  const environment = { ...process.env };
  delete environment.ISN_TEST_WRITE_WINDOW;
  delete environment.ISN_POSTS_SCENARIO_RUNNER_TOKEN;
  delete environment.ISN_POSTS_SCENARIO_GATE_FILE;
  const result = spawnSync(process.execPath, [runner], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  const after = readArtifactNames(artifactRoot);

  assert.notEqual(result.status, 0);
  assert.deepEqual(after, before);
  const diagnostic = JSON.parse(result.stderr);
  assert.equal(diagnostic.runner, 'BLOCKED_OR_FAILED');
  assert.equal(diagnostic.stage, 'execution');
  assert.equal(diagnostic.runId, null);
  assert.equal(typeof diagnostic.error.name, 'string');
  assert.equal(typeof diagnostic.error.message, 'string');
  assert.ok(diagnostic.error.stack.includes(diagnostic.error.message));
});

test('direct Playwright config refusal happens without config-owned server or key startup', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
  const config = resolve(root, 'tests/e2e/posts.playwright.config.ts');
  const environment = { ...process.env };
  delete environment.ISN_POSTS_SCENARIO_DISCOVERY;
  delete environment.ISN_POSTS_SCENARIO_RUNNER_TOKEN;
  delete environment.ISN_POSTS_SCENARIO_DATABASE_ID;
  delete environment.ISN_POSTS_SCENARIO_GATE_FILE;
  const before = readArtifactNames(resolve(root, '.artifacts'));
  const result = spawnSync(process.execPath, [cli, 'test', '--config', config], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use the guarded Posts scenario runner/u);
  assert.deepEqual(readArtifactNames(resolve(root, '.artifacts')), before);
});

test('direct read-only V5 preflight refusal creates no keys, fixtures, or service artifacts', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const preflight = resolve(root, 'tests/integration/neo4j/posts-acceptance-preflight.mjs');
  const before = readArtifactNames(resolve(root, '.artifacts'));
  const environment = { ...process.env };
  delete environment.ISN_TEST_WRITE_WINDOW;
  delete environment.ISN_B_WORKLOAD_CLEAR;
  const result = spawnSync(process.execPath, [preflight], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /"preflight":"BLOCKED"/u);
  assert.deepEqual(readArtifactNames(resolve(root, '.artifacts')), before);
});

function readArtifactNames(root) {
  const names = [];
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      names.push(relative);
      if (entry.isDirectory()) visit(resolve(directory, entry.name), relative);
    }
  };
  try {
    visit(root);
    return names.filter((name) => !/^weylume\/posts-acceptance\/run-[0-9a-f-]{36}\.json$/iu.test(name)).sort();
  }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
