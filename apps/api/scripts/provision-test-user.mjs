import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';

const username = 'isn_test_runner';
const role = 'isn_test_runner_role';
const uri = process.env.NEO4J_URI;
const adminUsername = process.env.NEO4J_USERNAME;
const adminPassword = process.env.NEO4J_PASSWORD;
const credentialsPath = resolve('apps/api/.env.test.local');
if (!uri || !adminUsername || !adminPassword) {
  throw new Error('Load the development administrator configuration before provisioning');
}

const expectedPrivileges = [
  'GRANT ACCESS ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'DENY ACCESS ON DATABASE `isn-dev` TO `isn_test_runner_role`',
  'GRANT CREATE CONSTRAINT ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT SHOW CONSTRAINT ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE NEW NODE LABEL ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT CREATE NEW PROPERTY NAME ON DATABASE `isn-test` TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MATCH {*} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {key} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MERGE {version} ON GRAPH `isn-test` NODE ISNSchema TO `isn_test_runner_role`',
  'GRANT MERGE {version} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {name} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {checksum} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {status} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {appliedAt} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
  'GRANT MERGE {verifiedAt} ON GRAPH `isn-test` NODE ISNSchemaMigration TO `isn_test_runner_role`',
];

const driver = neo4j.driver(uri, neo4j.auth.basic(adminUsername, adminPassword));
let generatedFile = false;
let userCreated = false;
try {
  await driver.verifyConnectivity();
  const system = driver.session({ database: 'system' });
  try {
    const dbms = await system.run('CALL dbms.components() YIELD versions, edition RETURN versions[0] AS version, edition');
    const server = dbms.records[0];
    if (server?.get('version') !== '2026.09.0' || server?.get('edition') !== 'enterprise') {
      throw new Error('Unexpected Neo4j server version or edition; provisioning stopped');
    }
    const users = await system.run(
      'SHOW USERS YIELD user, roles, home, suspended WHERE user = $username RETURN user, roles, home, suspended',
      { username },
    );
    const existingUser = users.records[0];
    const roles = await system.run('SHOW ROLES YIELD role, immutable WHERE role = $role RETURN role, immutable', { role });
    const existingRole = roles.records[0];

    if (existingUser) {
      const assigned = [...existingUser.get('roles')].sort();
      if (existingUser.get('home') !== 'isn-test' || existingUser.get('suspended') ||
          JSON.stringify(assigned) !== JSON.stringify(['PUBLIC', role])) {
        throw new Error('Existing test user has unexpected home, status, or role assignments; no changes made');
      }
      const secretFile = await readFile(credentialsPath, 'utf8').catch(() => '');
      const password = secretFile.match(/^NEO4J_TEST_PASSWORD=(.*)$/m)?.[1];
      if (!password) throw new Error('Test user exists but its local credential is unavailable; refusing password rotation');
      const check = neo4j.driver(uri, neo4j.auth.basic(username, password));
      try {
        await check.verifyConnectivity();
        const session = check.session({ database: 'isn-test' });
        try {
          const identity = await session.run('CALL db.info() YIELD name RETURN name');
          if (identity.records[0]?.get('name') !== 'isn-test') throw new Error('Test user target identity mismatch');
        } finally { await session.close(); }
      } finally { await check.close(); }
    } else {
      if (existingRole?.get('immutable')) throw new Error('Expected role name is occupied by an immutable role; provisioning stopped');
      let existingCredentials = '';
      try { existingCredentials = await readFile(credentialsPath, 'utf8'); } catch {}
      if (existingCredentials) throw new Error('Credential file exists while test user is absent; inspect local state before provisioning');
      const password = randomBytes(36).toString('base64url');
      await writeFile(credentialsPath,
        `NODE_ENV=test\nNEO4J_URI=${uri}\nNEO4J_DATABASE=isn-test\nNEO4J_TEST_USERNAME=${username}\nNEO4J_TEST_PASSWORD=${password}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await chmod(credentialsPath, 0o600).catch(() => undefined);
      generatedFile = true;
      if (!existingRole) await system.run('CREATE ROLE isn_test_runner_role');
      const grants = existingRole ? await system.run('SHOW ROLE $role PRIVILEGES AS COMMANDS', { role }) : null;
      if (grants?.records.length) throw new Error('Existing custom role is not empty; inspect manually before provisioning');
      for (const command of expectedPrivileges) {
        await system.run(command);
      }
      await system.run(
        'CREATE USER $username SET PASSWORD $password CHANGE NOT REQUIRED SET HOME DATABASE $home',
        { username, password, home: 'isn-test' },
      );
      userCreated = true;
      await system.run('GRANT ROLE isn_test_runner_role TO USER isn_test_runner');
    }

    const finalUser = await system.run(
      'SHOW USERS YIELD user, roles, home, suspended WHERE user = $username RETURN user, roles, home, suspended',
      { username },
    );
    const finalRoles = await system.run('SHOW ROLE $role PRIVILEGES AS COMMANDS', { role });
    const commands = finalRoles.records.map((record) => String(record.get('command')));
    const roleAssignment = finalUser.records[0];
    const assigned = roleAssignment ? [...roleAssignment.get('roles')].sort() : [];
    if (roleAssignment?.get('home') !== 'isn-test' ||
        JSON.stringify(assigned) !== JSON.stringify(['PUBLIC', role]) ||
        JSON.stringify([...commands].sort()) !== JSON.stringify([...expectedPrivileges].sort())) {
      throw new Error('Provisioned user or effective role grants did not match the approved least-privilege set');
    }
  } finally {
    await system.close();
  }

  const credentials = await readFile(credentialsPath, 'utf8');
  const password = credentials.match(/^NEO4J_TEST_PASSWORD=(.*)$/m)?.[1];
  if (!password) throw new Error('Local test password is missing after provisioning');
  const testDriver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    await testDriver.verifyConnectivity();
    const testSession = testDriver.session({ database: 'isn-test' });
    try {
      const identity = await testSession.run('CALL db.info() YIELD name RETURN name');
      if (identity.records[0]?.get('name') !== 'isn-test') throw new Error('Test database identity verification failed');
    } finally { await testSession.close(); }
    const devSession = testDriver.session({ database: 'isn-dev' });
    try {
      await devSession.run('CALL db.ping()');
      throw new Error('Test account unexpectedly accessed isn-dev');
    } catch (error) {
      if (error.message === 'Test account unexpectedly accessed isn-dev' || !String(error.code ?? '').startsWith('Neo.ClientError.Security.')) throw error;
    } finally { await devSession.close(); }
  } finally {
    await testDriver.close();
  }
  console.log(JSON.stringify({ provisioned: true, username, role, homeDatabase: 'isn-test', devAccess: 'denied', credentialsStoredLocally: true }));
} catch (error) {
  if (generatedFile && !userCreated) {
    await import('node:fs/promises').then(({ unlink }) => unlink(credentialsPath).catch(() => undefined));
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await driver.close();
}
