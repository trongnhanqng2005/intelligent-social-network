import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  assessPostsScenarioResourceCapacity,
  assessPostsScenarioRuntimeCapacity,
  measurePostsScenarioObservedResourceDelta,
  summarizeResourceSamples,
} from '../fixtures/posts/resource-safety.mjs';

function samples({ available = 10_000, commitHeadroom = 10_000, paging = [] } = {}) {
  return Array.from({ length: 6 }, (_, index) => ({
    availablePhysicalBytes: available,
    committedBytes: 20_000 - commitHeadroom,
    commitLimitBytes: 20_000,
    pagesInputPerSec: paging[index] ?? 0,
    pagesOutputPerSec: 0,
    pageReadsPerSec: 0,
  }));
}

const clearWorkloads = { dockerWorkloadCount: 0, wslWorkloadCount: 0 };

test('Stage A records observed machine health without forecasting global Node or browser processes', () => {
  const result = assessPostsScenarioResourceCapacity({
    samples: samples({ available: 250, commitHeadroom: 300 }),
    sparkWorkloadActive: false,
    workloadsVerified: true,
    ...clearWorkloads,
  });

  assert.equal(result.safe, true);
  assert.equal(result.minimumAvailablePhysicalBytes, 250);
  assert.equal(result.minimumCommitHeadroomBytes, 300);
  assert.equal(result.demand, null);
});

test('Stage A still fails closed on zero headroom or unknown Spark and workload state', () => {
  const noPhysical = assessPostsScenarioResourceCapacity({
    samples: samples({ available: 0 }), sparkWorkloadActive: false, workloadsVerified: true, ...clearWorkloads,
  });
  const noCommit = assessPostsScenarioResourceCapacity({
    samples: samples({ commitHeadroom: 0 }), sparkWorkloadActive: false, workloadsVerified: true, ...clearWorkloads,
  });
  const unknownSpark = assessPostsScenarioResourceCapacity({
    samples: samples(), sparkWorkloadActive: null, workloadsVerified: true, ...clearWorkloads,
  });

  assert.equal(noPhysical.safe, false);
  assert.match(noPhysical.issues.join(' '), /physical memory is exhausted/u);
  assert.equal(noCommit.safe, false);
  assert.match(noCommit.issues.join(' '), /commit capacity is exhausted/u);
  assert.equal(unknownSpark.safe, false);
  assert.match(unknownSpark.issues.join(' '), /Spark activity is active or could not be ruled out/u);
});

test('runtime capacity compares measured headroom with measured demand without a speculative multiplier', () => {
  const result = assessPostsScenarioRuntimeCapacity({
    samples: samples({ available: 100, commitHeadroom: 150 }),
    requiredHeadroomBytes: { physical: 100, commit: 150 },
    sparkWorkloadActive: false,
    workloadsVerified: true,
    ...clearWorkloads,
  });

  assert.equal(result.safe, true);
  assert.equal(result.requiredPhysicalHeadroomBytes, 100);
  assert.equal(result.requiredCommitHeadroomBytes, 150);
});

test('resource demand uses observed system-headroom deltas and clamps unrelated recovery to zero', () => {
  const baseline = { minimumAvailablePhysicalBytes: 2_000, minimumCommitHeadroomBytes: 3_000 };
  const lower = measurePostsScenarioObservedResourceDelta(baseline, samples({ available: 1_500, commitHeadroom: 2_100 }));
  const higher = measurePostsScenarioObservedResourceDelta(baseline, samples({ available: 2_200, commitHeadroom: 3_500 }));

  assert.deepEqual(lower, { physical: 500, commit: 900 });
  assert.deepEqual(higher, { physical: 0, commit: 0 });
});

test('Windows process inventory avoids command lines and uses byte-valued process memory fields', async () => {
  const source = await readFile(new URL('../fixtures/posts/resource-safety.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /CommandLine/u);
  assert.match(source, /WorkingSet64/u);
  assert.match(source, /PrivateMemorySize64/u);
});

test('resource capacity records paging without blocking adequate headroom, and rejects overlapping workloads', () => {
  const paging = assessPostsScenarioResourceCapacity({
    samples: samples({ paging: [1, 1, 1, 0, 0, 0] }), sparkWorkloadActive: false, workloadsVerified: true,
    ...clearWorkloads,
  });
  const spark = assessPostsScenarioResourceCapacity({ samples: samples(), sparkWorkloadActive: true, workloadsVerified: true });
  const unknownWorkloads = assessPostsScenarioResourceCapacity({
    samples: samples(), sparkWorkloadActive: false, workloadsVerified: false, ...clearWorkloads,
  });
  const dockerWorkload = assessPostsScenarioResourceCapacity({
    samples: samples(), sparkWorkloadActive: false, workloadsVerified: true,
    dockerWorkloadCount: 1, wslWorkloadCount: 0,
  });
  const wslWorkload = assessPostsScenarioRuntimeCapacity({
    samples: samples(), requiredHeadroomBytes: 1,
    sparkWorkloadActive: false, workloadsVerified: true,
    dockerWorkloadCount: 0, wslWorkloadCount: 1,
  });
  const missingWorkloadCounts = assessPostsScenarioResourceCapacity({
    samples: samples(), sparkWorkloadActive: false, workloadsVerified: true,
  });

  assert.equal(paging.safe, true);
  assert.equal(paging.sustainedPaging, true);
  assert.match(paging.warnings.join(' '), /Paging activity/u);
  assert.equal(spark.safe, false);
  assert.equal(unknownWorkloads.safe, false);
  assert.match(unknownWorkloads.issues.join(' '), /Docker\/WSL/u);
  assert.equal(dockerWorkload.safe, false);
  assert.match(dockerWorkload.issues.join(' '), /Docker workload/u);
  assert.equal(wslWorkload.safe, false);
  assert.match(wslWorkload.issues.join(' '), /WSL workload/u);
  assert.equal(missingWorkloadCounts.safe, false);
  assert.match(missingWorkloadCounts.issues.join(' '), /workload counts are unavailable/u);
});

test('transient paging in isolated samples is reported but does not count as sustained paging', () => {
  const result = summarizeResourceSamples(samples({ paging: [5, 0, 1, 0, 0, 0] }));

  assert.equal(result.sustainedPaging, false);
  assert.equal(result.maximumConsecutivePagingSamples, 1);
  assert.deepEqual(result.issues, []);
});

test('sustained page reads remain visible even when page-input counters are zero', () => {
  const result = summarizeResourceSamples(samples().map((sample, index) => ({
    ...sample,
    pageReadsPerSec: index < 3 ? 1 : 0,
  })));

  assert.equal(result.sustainedPaging, true);
  assert.match(result.warnings.join(' '), /Paging activity persisted/u);
});

test('resource sampling rejects incomplete paging and commit measurements', () => {
  const result = summarizeResourceSamples(samples().map((sample, index) => index === 2
    ? { ...sample, pageReadsPerSec: undefined }
    : sample));

  assert.match(result.issues.join(' '), /missing valid/u);
});

test('runtime capacity blocks inadequate headroom even with paging and fails closed on incomplete samples', () => {
  const pressure = assessPostsScenarioRuntimeCapacity({
    samples: samples({ available: 999, paging: [0, 2, 2, 2, 0, 0] }),
    requiredHeadroomBytes: 1_000,
    sparkWorkloadActive: false,
    workloadsVerified: true,
    ...clearWorkloads,
  });
  const inconclusive = assessPostsScenarioRuntimeCapacity({
    samples: samples().slice(0, 2), requiredHeadroomBytes: 1, sparkWorkloadActive: false,
  });

  assert.equal(pressure.safe, false);
  assert.match(pressure.issues.join(' '), /physical memory/u);
  assert.match(pressure.warnings.join(' '), /Paging activity/u);
  assert.equal(inconclusive.safe, false);
  assert.match(inconclusive.issues.join(' '), /Fewer than three/u);
});

test('runtime capacity blocks inadequate commit headroom even without paging', () => {
  const result = assessPostsScenarioRuntimeCapacity({
    samples: samples({ commitHeadroom: 999 }), requiredHeadroomBytes: { physical: 1, commit: 1_000 },
    sparkWorkloadActive: false, workloadsVerified: true, ...clearWorkloads,
  });
  assert.equal(result.safe, false);
  assert.match(result.issues.join(' '), /commit capacity/u);
});
