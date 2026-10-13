import { validateEnvironment } from './env.validation.js';

const developmentDatabaseConfig = {
  NEO4J_URI: 'neo4j://127.0.0.1:7687',
  NEO4J_USERNAME: 'local-user',
  NEO4J_PASSWORD: 'local-password',
  NEO4J_DATABASE: 'isn-dev',
  AUTH_PRIVATE_KEY_PATH: 'private.pem',
  AUTH_PUBLIC_KEY_PATH: 'public.pem',
  AUTH_CSRF_SECRET_PATH: 'csrf.secret',
  AUTH_KEY_ID: 'local-key-1',
  AUTH_ISSUER: 'http://127.0.0.1:3000',
  AUTH_AUDIENCE: 'intelligent-social-network-web',
  AUTH_WEB_ORIGIN: 'http://127.0.0.1:5173',
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
      ...Object.fromEntries(Object.entries(developmentDatabaseConfig).filter(([key]) => key.startsWith('AUTH_'))),
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
          ...(nodeEnv === 'production'
            ? { AUTH_WEB_ORIGIN: 'https://social.example.test', AUTH_ISSUER: 'https://social.example.test' }
            : {}),
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

  it('requires HTTPS for the production web origin', () => {
    expect(() => validateEnvironment({
      ...developmentDatabaseConfig,
      NODE_ENV: 'production',
      AUTH_ISSUER: 'https://social.example.test',
      AUTH_WEB_ORIGIN: 'http://social.example.test',
    })).toThrow('AUTH_WEB_ORIGIN must be a valid HTTPS origin in production');
  });

  it('rejects weak key identifiers and malformed production issuers', () => {
    expect(() => validateEnvironment({ ...developmentDatabaseConfig, AUTH_KEY_ID: 'bad key' }))
      .toThrow('AUTH_KEY_ID must use 1-128 URL-safe identifier characters');
    expect(() => validateEnvironment({
      ...developmentDatabaseConfig,
      NODE_ENV: 'production',
      AUTH_ISSUER: 'http://social.example.test',
      AUTH_WEB_ORIGIN: 'https://social.example.test',
    })).toThrow('AUTH_ISSUER must be an HTTPS URL in production');
  });
});
