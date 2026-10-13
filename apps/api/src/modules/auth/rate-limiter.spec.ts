import { AuthRateLimiter } from './rate-limiter.js';

describe('AuthRateLimiter', () => {
  it('allows requests up to the bounded limit then returns retry time', () => {
    const limiter = new AuthRateLimiter();
    expect(limiter.consume('login', 2, 60_000, 10_000)).toBe(0);
    expect(limiter.consume('login', 2, 60_000, 10_001)).toBe(0);
    expect(limiter.consume('login', 2, 60_000, 10_002)).toBe(60);
  });

  it('expires windows and does not retain raw login identities in keys', () => {
    const limiter = new AuthRateLimiter();
    const key = AuthRateLimiter.identityKey('login', 'alice@example.test');
    expect(key).not.toContain('alice@example.test');
    expect(limiter.consume(key, 1, 1_000, 0)).toBe(0);
    expect(limiter.consume(key, 1, 1_000, 1_001)).toBe(0);
    expect(limiter.size).toBe(1);
  });
});
