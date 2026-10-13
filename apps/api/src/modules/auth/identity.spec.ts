import { normalizeEmail, validatePassword } from './identity.js';

describe('authentication identity', () => {
  it('trims and lowercases email without provider-specific rewriting', () => {
    expect(normalizeEmail('  Alice+news@Example.COM ')).toBe('alice+news@example.com');
  });

  it.each(['', 'not-an-email', 'x'.repeat(250) + '@example.test'])(
    'rejects invalid email %s',
    (email) => {
      expect(() => normalizeEmail(email)).toThrow();
    },
  );

  it('accepts a Unicode password without normalizing it', () => {
    expect(validatePassword('  mật khẩu của tôi  ')).toBe('  mật khẩu của tôi  ');
  });

  it.each(['short', '🟩'.repeat(129), 'a'.repeat(513)])(
    'rejects passwords outside the approved bounds',
    (password) => {
      expect(() => validatePassword(password)).toThrow();
    },
  );
});
