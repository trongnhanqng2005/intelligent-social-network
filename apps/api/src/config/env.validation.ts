const nodeEnvironments = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof nodeEnvironments)[number];

export interface EnvironmentConfig {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  HOST: string;
  NEO4J_URI: string;
  NEO4J_USERNAME: string;
  NEO4J_PASSWORD: string;
  NEO4J_DATABASE: string;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentConfig {
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !nodeEnvironments.includes(nodeEnv as NodeEnvironment)
  ) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const portValue = config.PORT ?? '3000';
  if (typeof portValue !== 'string' || !/^\d+$/.test(portValue)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const hostValue = config.HOST ?? '127.0.0.1';
  if (typeof hostValue !== 'string' || hostValue.trim().length === 0) {
    throw new Error('HOST must be a non-empty string');
  }

  const neo4jUri = config.NEO4J_URI;
  if (typeof neo4jUri !== 'string') {
    throw new Error('NEO4J_URI must be configured');
  }

  let parsedNeo4jUri: URL;
  try {
    parsedNeo4jUri = new URL(neo4jUri);
  } catch {
    throw new Error('NEO4J_URI must be a valid Neo4j driver URI');
  }

  if (
    !['neo4j:', 'neo4j+s:', 'neo4j+ssc:', 'bolt:', 'bolt+s:', 'bolt+ssc:'].includes(
      parsedNeo4jUri.protocol,
    ) ||
    !parsedNeo4jUri.hostname ||
    parsedNeo4jUri.username ||
    parsedNeo4jUri.password
  ) {
    throw new Error('NEO4J_URI must use a supported Neo4j driver scheme');
  }

  const usernameKey = nodeEnv === 'test' ? 'NEO4J_TEST_USERNAME' : 'NEO4J_USERNAME';
  const passwordKey = nodeEnv === 'test' ? 'NEO4J_TEST_PASSWORD' : 'NEO4J_PASSWORD';
  const neo4jUsername = config[usernameKey];
  if (typeof neo4jUsername !== 'string' || neo4jUsername.trim().length === 0) {
    throw new Error(`${usernameKey} must be configured`);
  }

  const neo4jPassword = config[passwordKey];
  if (typeof neo4jPassword !== 'string' || neo4jPassword.length === 0) {
    throw new Error(`${passwordKey} must be configured`);
  }

  const neo4jDatabase = config.NEO4J_DATABASE;
  if (typeof neo4jDatabase !== 'string' || neo4jDatabase.trim().length === 0) {
    throw new Error('NEO4J_DATABASE must be configured');
  }

  const database = neo4jDatabase.trim();
  if (nodeEnv === 'development' && database !== 'isn-dev') {
    throw new Error('NODE_ENV=development requires NEO4J_DATABASE=isn-dev');
  }
  if (nodeEnv === 'test' && database !== 'isn-test') {
    throw new Error('NODE_ENV=test requires NEO4J_DATABASE=isn-test');
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    PORT: port,
    HOST: hostValue.trim(),
    NEO4J_URI: neo4jUri,
    NEO4J_USERNAME: neo4jUsername.trim(),
    NEO4J_PASSWORD: neo4jPassword,
    NEO4J_DATABASE: database,
  };
}
