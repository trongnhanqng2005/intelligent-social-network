import { validateEnvironment } from './env.validation.js';

const developmentDatabaseConfig = {
  NEO4J_URI: 'neo4j://127.0.0.1:7687',
  NEO4J_USERNAME: 'local-user',
  NEO4J_PASSWORD: 'local-password',
  NEO4J_DATABASE: 'isn-dev',
};

describe('validateEnvironment', () => {
  it('provides safe local defaults', () => {
    expect(validateEnvironment(developmentDatabaseConfig)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '127.0.0.1',
      ...developmentDatabaseConfig,
    });
  });

  it('parses valid server settings and permits unrelated environment variables', () => {
    expect(
      validateEnvironment({
        ...developmentDatabaseConfig,
        NEO4J_DATABASE: 'isn-test',
        NEO4J_TEST_USERNAME: 'test-user',
        NEO4J_TEST_PASSWORD: 'test-password',
        NODE_ENV: 'test',
        PORT: '4310',
        HOST: '0.0.0.0',
        PATH: 'ignored by application validation',
      }),
    ).toEqual({
      ...developmentDatabaseConfig,
      NEO4J_DATABASE: 'isn-test',
      NEO4J_USERNAME: 'test-user',
      NEO4J_PASSWORD: 'test-password',
      NODE_ENV: 'test',
      PORT: 4310,
      HOST: '0.0.0.0',
    });
  });

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    (nodeEnv) => {
      const database =
        nodeEnv === 'test'
          ? {
              NEO4J_DATABASE: 'isn-test',
              NEO4J_TEST_USERNAME: 'test-user',
              NEO4J_TEST_PASSWORD: 'test-password',
            }
          : {};
      expect(
        validateEnvironment({
          ...developmentDatabaseConfig,
          ...database,
          NODE_ENV: nodeEnv,
        }).NODE_ENV,
      ).toBe(nodeEnv);
    },
  );

  it.each(['', 'staging', 'Development', 42])(
    'rejects invalid NODE_ENV=%s without echoing the value',
    (nodeEnv) => {
      expect(() => validateEnvironment({ NODE_ENV: nodeEnv })).toThrow(
        'NODE_ENV must be development, test, or production',
      );
    },
  );

  it.each(['', '0', '65536', '3000.5', '1e3', 'not-a-port'])(
    'rejects invalid PORT=%s',
    (port) => {
      expect(() => validateEnvironment({ PORT: port })).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );

  it.each(['', '   '])('rejects empty HOST=%s', (host) => {
    expect(() => validateEnvironment({ HOST: host })).toThrow(
      'HOST must be a non-empty string',
    );
  });

  it.each(['', undefined])('rejects missing Neo4j credentials', (password) => {
    expect(() =>
      validateEnvironment({
        ...developmentDatabaseConfig,
        NEO4J_PASSWORD: password,
      }),
    ).toThrow('NEO4J_PASSWORD must be configured');
  });

  it('rejects a development database when NODE_ENV is test', () => {
    expect(() =>
      validateEnvironment({
        ...developmentDatabaseConfig,
        NEO4J_TEST_USERNAME: 'test-user',
        NEO4J_TEST_PASSWORD: 'test-password',
        NODE_ENV: 'test',
      }),
    ).toThrow('NODE_ENV=test requires NEO4J_DATABASE=isn-test');
  });

  it('requires separate test credentials', () => {
    expect(() =>
      validateEnvironment({
        ...developmentDatabaseConfig,
        NEO4J_DATABASE: 'isn-test',
        NODE_ENV: 'test',
      }),
    ).toThrow('NEO4J_TEST_USERNAME must be configured');
  });

  it('rejects any database other than isn-dev for development', () => {
    expect(() =>
      validateEnvironment({ ...developmentDatabaseConfig, NEO4J_DATABASE: 'isn-test' }),
    ).toThrow('NODE_ENV=development requires NEO4J_DATABASE=isn-dev');
  });

  it('rejects unsupported Neo4j URI schemes without echoing credentials', () => {
    expect(() =>
      validateEnvironment({
        ...developmentDatabaseConfig,
        NEO4J_URI: 'https://127.0.0.1:7687',
      }),
    ).toThrow('NEO4J_URI must use a supported Neo4j driver scheme');
  });
});
