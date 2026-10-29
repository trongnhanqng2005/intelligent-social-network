import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { assertPostsWorktreeRoot, assertPostsWriteWindow } from '../../../apps/api/scripts/posts-operation-safety.mjs';

export function assertPostsScenarioExecutionTarget({ environment, cwd, repositoryRoot, branch, baselineAncestor }) {
  assertPostsWriteWindow(environment);
  assert.equal(environment.ISN_B_WORKLOAD_CLEAR, 'confirmed',
    'ISN-B workload coordination must be explicitly confirmed before the heavy browser run.');
  assertPostsWorktreeRoot(repositoryRoot, cwd);
  assert.equal(branch, 'feature/posts-feed', 'Posts scenarios run only on the approved feature branch.');
  assert.equal(baselineAncestor, true, 'The approved Step 4 baseline must be an ancestor of HEAD.');
  return true;
}

export async function assertPostsScenarioPortsFree(ports, host = '127.0.0.1') {
  for (const port of ports) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  return true;
}

export function assertPostsScenarioRunnerHandoff({ environment, marker, parentPid, runnerActive = false, argv = [], now = Date.now() }) {
  if (environment.ISN_POSTS_SCENARIO_DISCOVERY === '1') {
    return argv.includes('--list') ? 'discovery' : 'denied';
  }
  if (!marker || typeof marker !== 'object') return 'denied';
  const token = environment.ISN_POSTS_SCENARIO_RUNNER_TOKEN;
  if (!token || marker.tokenHash !== createHash('sha256').update(token).digest('hex')) return 'denied';
  if (marker.databaseId !== environment.ISN_POSTS_SCENARIO_DATABASE_ID) return 'denied';
  if (!Number.isSafeInteger(marker.runnerPid) || (marker.runnerPid !== parentPid && !runnerActive)) return 'denied';
  if (!Number.isSafeInteger(marker.expiresAt) || marker.expiresAt <= now) return 'denied';
  return 'run';
}

export function summarizePostsPlaywrightReport(report) {
  assert.ok(Array.isArray(report?.suites), 'Playwright JSON report is missing its suite list.');
  const stats = {};
  for (const key of ['expected', 'skipped', 'unexpected', 'flaky']) {
    const count = report.stats?.[key];
    assert.ok(Number.isSafeInteger(count) && count >= 0, `Playwright JSON report has invalid ${key} statistics.`);
    stats[key] = count;
  }
  const tests = [];
  const visit = (suites = []) => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const results = test.results ?? [];
          const failureResult = [...results].reverse().find((result) => result.errors?.length);
          const failure = failureResult?.errors?.[0];
          tests.push({
            title: spec.title,
            status: test.status,
            ...(failure ? {
              failure: sanitizePostsScenarioFailure(failure),
              ...(failureResult.errorLocation ? { location: failureResult.errorLocation } : {}),
            } : {}),
          });
        }
      }
      visit(suite.suites);
    }
  };
  visit(report?.suites);
  const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
  assert.ok(total > 0, 'Playwright JSON report contains no completed tests.');
  assert.equal(tests.length, total, 'Playwright JSON report test count does not match report statistics.');
  assert.ok(tests.every((test) => ['expected', 'skipped', 'unexpected', 'flaky'].includes(test.status)),
    'Playwright JSON report contains an unknown test outcome.');
  return {
    stats,
    tests,
  };
}

export function capturePostsScenarioOutput(child, limit = 20_000) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0);
  const output = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) {
    if (!child[stream]) continue;
    child[stream].setEncoding('utf8');
    child[stream].on('data', (chunk) => {
      output[stream] = `${output[stream]}${chunk}`.slice(-limit);
    });
  }
  return () => ({ ...output });
}

export function getPostsScenarioOwnedPids(services, childPid) {
  return [
    ...services.map((service) => service.pid).filter((pid) => Number.isSafeInteger(pid) && pid > 0),
    ...(Number.isSafeInteger(childPid) && childPid > 0 ? [childPid] : []),
  ];
}

export async function runPostsSerialCases(cases, runCase) {
  for (const scenario of cases) {
    const result = await runCase(scenario);
    if (!result.resourceStatus.safe || result.reportStatus !== 'CAPTURED') break;
  }
}

export async function runPostsScenario({ preflight, prepare, start, run, stop, dispose }) {
  const gate = await preflight();
  let prepareAttempted = false;
  let startAttempted = false;
  let result;
  let failure;

  try {
    prepareAttempted = true;
    await prepare(gate);
    startAttempted = true;
    await start(gate);
    result = await run(gate);
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  let runtimeStopped = !startAttempted;
  if (startAttempted) {
    try {
      await stop(gate);
      runtimeStopped = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (prepareAttempted && runtimeStopped) {
    try { await dispose(gate); } catch (error) { cleanupErrors.push(error); }
  }

  if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Posts scenario run and cleanup failed.');
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Posts scenario cleanup failed.');
  return result;
}

export function sanitizePostsScenarioFailure(error) {
  const message = (typeof error === 'string' ? error : error?.message ?? String(error))
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .join(' | ') || 'Unknown Playwright failure';
  return message
    .replace(/[\w.+-]+@example\.invalid/giu, '[synthetic-email]')
    .replace(/Weylume-Scenario-[\w-]+!/gu, '[synthetic-password]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu, '[token]')
    .replace(/\b(csrf|authorization|cookie)(\s*[:=]\s*)[^\s,;]+/giu, '$1$2[redacted]')
    .slice(0, 1_500);
}
