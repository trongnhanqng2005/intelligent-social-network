import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectPostsScenarioResourceInventory, POSTS_SCENARIO_BROWSER_CONTEXTS } from '../fixtures/posts/resource-safety.mjs';

const apiOrigin = 'http://127.0.0.1:3312';
const webOrigin = 'http://127.0.0.1:5182';
const contexts = [];
let browser;

try {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  browser = await chromium.launch({ headless: true });
  const pages = [];
  for (let index = 0; index < POSTS_SCENARIO_BROWSER_CONTEXTS; index += 1) {
    const context = await browser.newContext({ baseURL: webOrigin, viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    pages.push(await context.newPage());
  }
  pages.push(await contexts[0].newPage());
  for (const page of pages) {
    const response = await page.goto('/dang-nhap');
    assert.equal(response?.status(), 200);
    assert.match(page.url(), /\/dang-nhap$/u);
  }

  const inventory = collectPostsScenarioResourceInventory({
    sampleCount: 3,
    intervalSeconds: 2,
    ownedPids: [process.pid],
    verifyWorkloads: false,
  });
  assert.equal(inventory.sparkWorkloadActive, false);
  assert.equal(inventory.ownedProcessTree.processCount > 1, true);
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    browserContexts: contexts.length,
    pages: pages.length,
    samples: inventory.samples,
    ownedProcessTree: inventory.ownedProcessTree,
    sparkWorkloadActive: inventory.sparkWorkloadActive,
    unclassifiedJavaProcessCount: inventory.unclassifiedJavaProcessCount,
    neo4jJavaProcessCount: inventory.neo4jJavaProcessCount,
  })}\n`);
} catch {
  process.stderr.write('Posts read-only browser capacity probe failed.\n');
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  await browser?.close().catch(() => undefined);
}
