import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  it('stores and verifies an Argon2id PHC hash without exposing the password', async () => {
    const service = new PasswordService();
    const hash = await service.hash('a sufficiently long password');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('a sufficiently long password');
    await expect(service.verify(hash, 'a sufficiently long password')).resolves.toBe(true);
    await expect(service.verify(hash, 'a different sufficiently long password')).resolves.toBe(false);
  });

  it('rejects malformed or non-Argon2id stored values without authenticating', async () => {
    await expect(new PasswordService().verify('not-a-hash', 'password')).resolves.toBe(false);
  });
});
