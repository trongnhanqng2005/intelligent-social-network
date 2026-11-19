import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startPostsScenarioResourceMonitor } from '../fixtures/posts/resource-monitor.mjs';
import { runPostsSerialCases, runPostsScenario } from '../fixtures/posts/scenario-runner.mjs';

const scenarioRunnerUrl = new URL('../fixtures/posts/scenario-runner.mjs', import.meta.url).href;
const childSource = `
  import assert from 'node:assert/strict';
  import { appendFile, readFile } from 'node:fs/promises';
  const [runnerUrl, markerPath, token, eventsPath] = process.argv.slice(1);
  const { assertPostsScenarioRunnerHandoff } = await import(runnerUrl);
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  assert.equal(assertPostsScenarioRunnerHandoff({
    environment: { ISN_POSTS_SCENARIO_RUNNER_TOKEN: token, ISN_POSTS_SCENARIO_DATABASE_ID: marker.databaseId },
    marker, parentPid: process.ppid,
  }), 'run');
  await appendFile(eventsPath, 'authorized\\n');
  process.send('authorized');
  process.on('message', async (message) => {
    if (message !== 'cleanup') return;
    await appendFile(eventsPath, 'cleanup-completed\\n');
    process.send('cleanup-completed');
    process.disconnect();
  });
`;

for (const outcome of ['unsafe', 'inconclusive']) {
  test(`resource ${outcome} fails closed through the runner and a real child`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'posts-resource-child-'));
    const markerPath = join(directory, 'handoff.json');
    const eventsPath = join(directory, 'child-events.log');
    const token = randomBytes(32).toString('hex');
    const marker = {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      runnerPid: process.pid,
      expiresAt: Date.now() + 60_000,
      databaseId: 'synthetic-no-database',
    };
    const started = [];
    let child;
    let disposed = false;

    try {
      await assert.rejects(runPostsScenario({
        preflight: async () => ({}),
        prepare: async () => writeFile(markerPath, JSON.stringify(marker), { flag: 'wx' }),
        start: async () => {},
        run: async () => runPostsSerialCases(['current', 'next'], async (name) => {
          started.push(name);
          child = spawn(process.execPath, ['--input-type=module', '-e', childSource,
            scenarioRunnerUrl, markerPath, token, eventsPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
          const [authorization] = await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
          assert.equal(authorization, 'authorized');

          const monitor = startPostsScenarioResourceMonitor({
            sample: async () => {
              if (outcome === 'inconclusive') throw new Error('synthetic sampling failure');
              return { safe: false, stage: 'runtime-capacity' };
            },
            onUnsafe: () => { throw new Error('synthetic handoff revocation failure'); },
          });
          const resourceStatus = await monitor.stop();
          assert.equal(resourceStatus.safe, false);
          assert.ok(resourceStatus.issues.length > 0);

          const closed = once(child, 'close', { signal: AbortSignal.timeout(5_000) });
          child.send('cleanup');
          const [cleanup] = await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
          assert.equal(cleanup, 'cleanup-completed');
          const [exitCode] = await closed;
          assert.equal(exitCode, 0);
          return { resourceStatus, reportStatus: 'CAPTURED' };
        }),
        stop: async () => { throw new Error('synthetic runtime cleanup incomplete'); },
        dispose: async () => {
          disposed = true;
          await rm(markerPath, { force: true });
        },
      }), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.match(error.errors[0].message, /runtime cleanup incomplete/u);
        return true;
      });

      assert.deepEqual(started, ['current']);
      assert.deepEqual((await readFile(eventsPath, 'utf8')).trim().split('\n'), ['authorized', 'cleanup-completed']);
      assert.equal(disposed, false);
      assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), marker);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, 'close', { signal: AbortSignal.timeout(5_000) }).catch(() => {});
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
