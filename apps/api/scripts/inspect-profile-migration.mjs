import neo4j from 'neo4j-driver';

const database = process.argv[2];
if (!['isn-dev', 'isn-test'].includes(database) || process.env.NEO4J_DATABASE !== database) {
  throw new Error('Usage: inspect-profile-migration.mjs <isn-dev|isn-test> with matching NEO4J_DATABASE');
}
if (database === 'isn-test' && (process.env.NEO4J_USERNAME || process.env.NEO4J_PASSWORD)) {
  throw new Error('Test inspection refuses development administrator credentials');
}
const username = database === 'isn-test' ? process.env.NEO4J_TEST_USERNAME : process.env.NEO4J_USERNAME;
const password = database === 'isn-test' ? process.env.NEO4J_TEST_PASSWORD : process.env.NEO4J_PASSWORD;
if (!process.env.NEO4J_URI || !username || !password) throw new Error('Target credentials unavailable');

const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(username, password));
const session = driver.session({ database });
try {
  const identity = await session.run('CALL db.info() YIELD name RETURN name');
  if (identity.records[0]?.get('name') !== database) throw new Error('Authenticated database identity mismatch');
  const principalResult = await session.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
  const principal = principalResult.records[0];
  const historyResult = await session.run(
    `MATCH (migration:ISNSchemaMigration)
     RETURN migration.version AS version, migration.name AS name,
            migration.checksum AS checksum, migration.status AS status,
            toString(migration.appliedAt) AS appliedAt,
            toString(migration.verifiedAt) AS verifiedAt ORDER BY version`,
  );
  const markerResult = await session.run(
    "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
  );
  const indexesResult = await session.run(
    'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state, populationPercent RETURN name, type, entityType, labelsOrTypes, properties, state, populationPercent ORDER BY name',
  );
  const profilesResult = await session.run(
    `MATCH (user:User)
     RETURN count(user) AS users,
       sum(CASE WHEN user.displayName IS NOT NULL THEN 1 ELSE 0 END) AS displayNames,
       sum(CASE WHEN user.bio IS NOT NULL THEN 1 ELSE 0 END) AS bios,
       sum(CASE WHEN user.location IS NOT NULL THEN 1 ELSE 0 END) AS locations,
       sum(CASE WHEN user.profileCreatedAt IS NOT NULL THEN 1 ELSE 0 END) AS createdAt,
       sum(CASE WHEN user.profileUpdatedAt IS NOT NULL THEN 1 ELSE 0 END) AS updatedAt,
       sum(CASE WHEN user.profileVersion IS NOT NULL THEN 1 ELSE 0 END) AS versions,
       sum(CASE WHEN user.displayNameSearch IS NOT NULL THEN 1 ELSE 0 END) AS searchKeys`,
  );
  const countsResult = await session.run(
    `CALL { MATCH (user:User) RETURN count(user) AS users }
     CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
     CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
     RETURN users, sessions, events`,
  );
  const convert = (record) => Object.fromEntries(record.keys.map((key) => [key, printable(record.get(key))]));
  console.log(JSON.stringify({
    database,
    principal: principal ? { username: principal.get('username'), roles: principal.get('roles') } : null,
    markerVersion: printable(markerResult.records[0]?.get('version')),
    migrations: historyResult.records.map(convert),
    indexes: indexesResult.records.map(convert),
    profilePropertyCounts: profilesResult.records[0] ? convert(profilesResult.records[0]) : null,
    authenticationCounts: countsResult.records[0] ? convert(countsResult.records[0]) : null,
  }));
} finally {
  await session.close();
  await driver.close();
}

function printable(value) {
  if (typeof value === 'object' && value !== null && typeof value.toNumber === 'function') return value.toNumber();
  if (Array.isArray(value)) return value.map(printable);
  return value;
}
