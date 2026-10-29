import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertPostsProvisioningTarget,
  assertPostsTestTarget,
  assertPostsWorktreeRoot,
  assertPostsWriteWindow,
} from '../../apps/api/scripts/posts-operation-safety.mjs';

const testTarget = {
  NODE_ENV: 'test',
  NEO4J_DATABASE: 'isn-test',
  NEO4J_URI: 'neo4j://127.0.0.1:7687',
  NEO4J_TEST_USERNAME: 'isn_test_runner',
  NEO4J_TEST_PASSWORD: 'synthetic-test-secret',
};

test('Posts data operations accept only dedicated restricted loopback isn-test settings', () => {
  assert.doesNotThrow(() => assertPostsTestTarget(testTarget));
  assert.throws(() => assertPostsTestTarget({ ...testTarget, NEO4J_DATABASE: 'isn-dev' }));
  assert.throws(() => assertPostsTestTarget({ ...testTarget, NEO4J_USERNAME: 'admin' }));
  assert.throws(() => assertPostsTestTarget({ ...testTarget, NEO4J_URI: 'neo4j://db.example:7687' }));
});

test('Posts write operations require an explicit invocation-only exclusive-window approval', () => {
  assert.throws(() => assertPostsWriteWindow(testTarget), /exclusive isn-test write window/u);
  assert.doesNotThrow(() => assertPostsWriteWindow({ ...testTarget, ISN_TEST_WRITE_WINDOW: 'owner-approved' }));
  assert.throws(() => assertPostsWriteWindow({ ...testTarget, ISN_TEST_WRITE_WINDOW: 'yes' }));
});

test('Posts privilege provisioning requires both isolated test and loopback administrator identities', () => {
  const provisioner = {
    ...testTarget,
    ISN_TEST_WRITE_WINDOW: 'owner-approved',
    NEO4J_USERNAME: 'local-admin',
    NEO4J_PASSWORD: 'separate-admin-secret',
  };
  assert.doesNotThrow(() => assertPostsProvisioningTarget(provisioner));
  assert.throws(() => assertPostsProvisioningTarget({ ...provisioner, NEO4J_TEST_USERNAME: 'admin' }));
  assert.throws(() => assertPostsProvisioningTarget({ ...provisioner, NEO4J_DATABASE: 'isn-dev' }));
});

test('Posts operational guards treat Windows Git root separators and case consistently', () => {
  assert.doesNotThrow(() => assertPostsWorktreeRoot(
    'D:/DoAn/BigData/isn-worktrees/posts-feed',
    'd:\\doan\\bigdata\\isn-worktrees\\posts-feed',
  ));
  assert.throws(() => assertPostsWorktreeRoot(
    'D:/DoAn/BigData/isn-worktrees/other',
    'D:/DoAn/BigData/isn-worktrees/posts-feed',
  ));
});
