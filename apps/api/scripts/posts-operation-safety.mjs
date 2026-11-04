import assert from 'node:assert/strict';

export function assertPostsWorktreeRoot(repositoryRoot, currentDirectory) {
  assert.equal(normalizePath(repositoryRoot), normalizePath(currentDirectory),
    'The Posts database operation must run from its owning worktree.');
}

export function assertPostsTestTarget(environment = process.env) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.NEO4J_DATABASE, 'isn-test');
  assert.equal(environment.NEO4J_TEST_USERNAME, 'isn_test_runner');
  assert.ok(environment.NEO4J_URI && environment.NEO4J_TEST_PASSWORD);
  assert.equal(environment.NEO4J_USERNAME || '', '');
  assert.equal(environment.NEO4J_PASSWORD || '', '');
  const uri = new URL(environment.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(uri.hostname));
  assert.equal(uri.port || '7687', '7687');
}

export function assertPostsWriteWindow(environment = process.env) {
  assertPostsTestTarget(environment);
  assert.equal(environment.ISN_TEST_WRITE_WINDOW, 'owner-approved',
    'Owner must explicitly confirm the exclusive isn-test write window for this invocation.');
}

export function assertPostsProvisioningTarget(environment = process.env) {
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.NEO4J_DATABASE, 'isn-test');
  assert.equal(environment.NEO4J_TEST_USERNAME, 'isn_test_runner');
  assert.ok(environment.NEO4J_TEST_PASSWORD);
  assert.equal(environment.ISN_TEST_WRITE_WINDOW, 'owner-approved',
    'Owner must explicitly confirm the exclusive isn-test write window for this invocation.');
  assert.ok(environment.NEO4J_URI && environment.NEO4J_USERNAME && environment.NEO4J_PASSWORD);
  const uri = new URL(environment.NEO4J_URI);
  assert.equal(uri.protocol, 'neo4j:');
  assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(uri.hostname));
  assert.equal(uri.port || '7687', '7687');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}
