import assert from 'node:assert/strict';
import { test } from 'node:test';

test('restricted test credentials target isn-test and verify cumulative V1/V2 schema', async () => {
  if (process.env.NODE_ENV !== 'test') {
    assert.fail('Set NODE_ENV=test before running real Neo4j integration tests');
  }
  if (process.env.NEO4J_DATABASE !== 'isn-test') {
    assert.fail('Set NEO4J_DATABASE=isn-test; real tests never fall back to another database');
  }

  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_TEST_USERNAME;
  const password = process.env.NEO4J_TEST_PASSWORD;
  if (!uri || !username || !password) {
    assert.fail(
      'Configure NEO4J_URI, NEO4J_TEST_USERNAME, and NEO4J_TEST_PASSWORD for real Neo4j tests',
    );
  }
  if (process.env.NEO4J_USERNAME || process.env.NEO4J_PASSWORD) {
    assert.fail('Do not provide development credentials to real Neo4j test execution');
  }

  process.env.NODE_ENV = 'test';
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(username, password),
  );
  let metadata;
  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database: 'isn-test' });
    try {
      const identityResult = await session.executeRead((tx) =>
        tx.run(
          'CALL db.info() YIELD id, name RETURN id, name',
        ),
      );
      const userResult = await session.executeRead((tx) =>
        tx.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles'),
      );
      metadata = {
        database: identityResult.records[0]?.get('name'),
        databaseId: identityResult.records[0]?.get('id'),
        username: userResult.records[0]?.get('username'),
        roles: userResult.records[0]?.get('roles'),
      };
    } finally {
      await session.close();
    }
  } catch {
    assert.fail('Authenticated read-only access to isn-test failed; connection details suppressed');
  }
  assert.equal(metadata?.database, 'isn-test');
  assert.equal(typeof metadata?.databaseId, 'string');
  assert.equal(metadata?.username, 'isn_test_runner');
  assert.deepEqual([...metadata.roles].sort(), ['PUBLIC', 'isn_test_runner_role']);

  const devSession = driver.session({ database: 'isn-dev' });
  let devDatabaseWasReachable = false;
  try {
    await devSession.executeRead((tx) => tx.run('CALL db.ping()'));
    devDatabaseWasReachable = true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    assert.match(code, /^Neo\.ClientError\.Security\./);
  } finally {
    await devSession.close();
  }
  assert.equal(devDatabaseWasReachable, false, 'test identity must not access isn-dev');

  const { NestFactory } = await import('@nestjs/core');
  const { Neo4jOperationsModule } = await import('../../../apps/api/dist/neo4j/neo4j-operations.module.js');
  const { Neo4jSchemaService } = await import(
    '../../../apps/api/dist/neo4j/neo4j-schema.service.js'
  );
  const app = await NestFactory.createApplicationContext(Neo4jOperationsModule, {
    logger: false,
  });

  try {
    const { Neo4jMigrationService } = await import('../../../apps/api/dist/neo4j/neo4j-migrations.js');
    const migrations = app.get(Neo4jMigrationService);
    const initialization = await migrations.migrate();
    const repeatInitialization = await migrations.migrate();

    assert.deepEqual({
      database: initialization.database,
      status: initialization.status,
      version: initialization.version,
    }, {
      database: 'isn-test',
      status: 'current',
      version: 2,
    });
    assert.deepEqual(repeatInitialization, initialization);
    assert.equal(initialization.migrations[0].status, 'VERIFIED');
    assert.equal(initialization.migrations[0].checksum, 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2');
    assert.equal(initialization.migrations[1].status, 'VERIFIED');
    assert.match(initialization.migrations[0].checksum, /^[a-f0-9]{64}$/);
    assert.equal(typeof initialization.migrations[0].appliedAt, 'string');
    assert.equal(typeof initialization.migrations[0].verifiedAt, 'string');

    const schemaService = app.get(Neo4jSchemaService);
    assert.deepEqual(await schemaService.checkReadiness(), {
      status: 'ready', database: 'isn-test', schemaVersion: 2,
    });

    console.log(
      JSON.stringify({
        database: initialization.database,
        schemaVersion: initialization.version,
        migrationVersions: initialization.migrations.map(({ version }) => version),
        migrationChecksumPresent: true,
        testIdentityRolesVerified: true,
        devDatabaseAccess: 'denied',
      }),
    );
  } catch {
    assert.fail(
      'Neo4j test integration failed; verify isn-test identity, server access, and least-privilege schema grants (details suppressed)',
    );
  } finally {
    await app.close();
    await driver.close();
  }
});
