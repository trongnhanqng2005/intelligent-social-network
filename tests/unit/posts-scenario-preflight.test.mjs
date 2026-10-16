import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertExactRestrictedPrivileges,
  assertV5Catalog,
  assertV5History,
  runPostsPreflightQueries,
  expectedV5Constraints,
  expectedV5Indexes,
  fingerprint,
} from '../fixtures/posts/scenario-preflight.mjs';

test('read-only queries sharing one Neo4j session are awaited sequentially', async () => {
  const queries = ['SHOW CONSTRAINTS', 'SHOW INDEXES', 'SHOW ROLE PRIVILEGES'];
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const session = {
    async run(query) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(query);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { query };
    },
  };

  const results = await runPostsPreflightQueries(session, queries);

  assert.deepEqual(calls, queries);
  assert.deepEqual(results, queries.map((query) => ({ query })));
  assert.equal(maximumActive, 1);
});

test('current V5 gate requires the exact twelve constraints and eighteen ONLINE indexes', () => {
  const constraints = expectedV5Constraints.map(([name, type, entityType, labelsOrTypes, properties]) => ({
    name, type, entityType, labelsOrTypes, properties,
  }));
  const indexes = expectedV5Indexes.map(([name, type, entityType, labelsOrTypes, properties]) => ({
    name, type, entityType, labelsOrTypes, properties, state: 'ONLINE',
  }));

  assert.equal(constraints.length, 12);
  assert.equal(indexes.length, 18);
  assert.equal(assertV5Catalog(constraints, indexes), true);
  assert.throws(() => assertV5Catalog(constraints.slice(1), indexes));
  assert.throws(() => assertV5Catalog(constraints, indexes.map((index, position) =>
    position === 0 ? { ...index, state: 'POPULATING' } : index)));
  assert.throws(() => assertV5Catalog([...constraints, { ...constraints[0], name: 'unexpected' }], indexes));
});

test('current V5 gate requires verified migration checksums, timestamps, marker and database identity', () => {
  const definitions = [1, 2, 3, 4, 5].map((version) => ({ version, name: `migration-${version}` }));
  const checksumMigration = ({ version }) => `checksum-${version}`;
  const status = {
    status: 'current', database: 'isn-test', version: 5,
    migrations: definitions.map(({ version, name }) => ({
      version, name, checksum: `checksum-${version}`, status: 'VERIFIED',
      appliedAt: 'applied', verifiedAt: 'verified',
    })),
  };

  assert.equal(assertV5History(status, definitions, checksumMigration), true);
  assert.throws(() => assertV5History({ ...status, status: 'drift' }, definitions, checksumMigration));
  assert.throws(() => assertV5History({ ...status, database: 'isn-dev' }, definitions, checksumMigration));
  assert.throws(() => assertV5History({ ...status, migrations: status.migrations.slice(0, 4) }, definitions, checksumMigration));
});

test('restricted-role gate requires all exact approved Post grants and matching effective privileges', () => {
  const approved = [
    'GRANT ACCESS ON DATABASE `isn-test` TO `isn_test_runner_role`',
    ...Array.from({ length: 14 }, (_, index) =>
      `GRANT SET PROPERTY {property${index}} ON GRAPH \`isn-test\` NODE Post TO \`isn_test_runner_role\``),
  ];
  const publicRole = [];
  const effective = [...approved, ...publicRole]
    .map((command) => command.replace(/ TO `(?:isn_test_runner_role|PUBLIC)`$/u, ' TO $role'));

  assert.equal(assertExactRestrictedPrivileges({ role: approved, publicRole, effective }, approved), true);
  assert.throws(() => assertExactRestrictedPrivileges({ role: approved.slice(1), publicRole, effective }, approved));
  assert.throws(() => assertExactRestrictedPrivileges({ role: approved, publicRole: ['GRANT ACCESS ON DATABASE `isn-dev` TO `PUBLIC`'], effective }, approved));
});

test('preflight fingerprints are stable, fixed length and do not return source values', () => {
  const privateRows = [{ account: 'synthetic-private@example.invalid', hash: 'private-hash' }];
  const digest = fingerprint(privateRows);
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(digest, fingerprint(privateRows));
  assert.equal(digest.includes('synthetic-private'), false);
});
