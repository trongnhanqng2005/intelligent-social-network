import { validateEnvironment } from './env.validation.js';

describe('validateEnvironment', () => {
  it('provides safe local defaults', () => {
    expect(validateEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '127.0.0.1',
    });
  });

  it('parses valid server settings and permits unrelated environment variables', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '4310',
        HOST: '0.0.0.0',
        PATH: 'ignored by application validation',
      }),
    ).toEqual({ NODE_ENV: 'test', PORT: 4310, HOST: '0.0.0.0' });
  });

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    (nodeEnv) => {
      expect(validateEnvironment({ NODE_ENV: nodeEnv }).NODE_ENV).toBe(nodeEnv);
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
});
