import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPostsScenarioResourceMonitor } from '../fixtures/posts/resource-monitor.mjs';
import { runPostsSerialCases } from '../fixtures/posts/scenario-runner.mjs';

test('runtime monitoring starts sampling immediately and stop waits for its pending assessment', async () => {
  let finishSample;
  let calls = 0;
  const monitor = startPostsScenarioResourceMonitor({
    intervalMs: 30_000,
    sample: () => {
      calls += 1;
      return new Promise((resolve) => { finishSample = resolve; });
    },
  });
  await Promise.resolve();
  assert.equal(calls, 1);

  let stopped = false;
  const stoppedMonitor = monitor.stop().then((result) => {
    stopped = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  finishSample({ safe: true, stage: 'runtime-capacity' });

  assert.deepEqual(await stoppedMonitor, { safe: true, stage: 'runtime-capacity', checks: 1 });
  assert.equal(stopped, true);
});

test('an inconclusive runtime sample fails closed with a diagnostic', async () => {
  const monitor = startPostsScenarioResourceMonitor({
    sample: async () => { throw new Error('private collector output'); },
  });

  const result = await monitor.stop();
  assert.equal(result.safe, false);
  assert.equal(result.stage, 'runtime-monitor');
  assert.equal(result.checks, 0);
  assert.deepEqual(result.issues, ['Resource monitoring became inconclusive.']);
  assert.doesNotMatch(JSON.stringify(result), /private collector output/u);
});

test('an unsafe assessment revokes future scenario handoff without interrupting the current scenario', async () => {
  let allowed = true;
  let cleanupCompleted = false;
  const currentScenario = async () => { await Promise.resolve(); cleanupCompleted = true; };
  const monitor = startPostsScenarioResourceMonitor({
    sample: async () => ({ safe: false, stage: 'runtime-capacity' }),
    onUnsafe: () => { allowed = false; },
  });
  const result = await monitor.stop();
  await currentScenario();
  assert.equal(result.safe, false);
  assert.equal(allowed, false);
  assert.equal(cleanupCompleted, true);
});

for (const revocationFails of [false, true]) {
  test(`serial runner stops after unsafe assessment when handoff revocation ${revocationFails ? 'fails' : 'succeeds'}`, async () => {
    const started = [];
    const cleaned = [];
    await runPostsSerialCases(['first', 'second'], async (name) => {
      started.push(name);
      const monitor = startPostsScenarioResourceMonitor({
        sample: async () => ({ safe: false }),
        onUnsafe: () => { if (revocationFails) throw new Error('handoff locked'); },
      });
      cleaned.push(name);
      return { resourceStatus: await monitor.stop(), reportStatus: 'CAPTURED' };
    });
    assert.deepEqual(started, ['first']);
    assert.deepEqual(cleaned, ['first']);
  });
}

test('serial runner starts the next scenario after a safe result and completed cleanup', async () => {
  const events = [];
  await runPostsSerialCases(['first', 'second'], async (name) => {
    events.push(`start ${name}`);
    events.push(`cleanup ${name}`);
    return { resourceStatus: { safe: true }, reportStatus: 'CAPTURED' };
  });
  assert.deepEqual(events, ['start first', 'cleanup first', 'start second', 'cleanup second']);
});
