import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPostsScenarioResourceMonitor } from '../fixtures/posts/resource-monitor.mjs';

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
