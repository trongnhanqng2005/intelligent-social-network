import { AuthRepository, AccountConflictError } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { JwtService } from './jwt.service.js';
import { PasswordService } from './password.service.js';

describe('AuthService', () => {
  let repository: jest.Mocked<AuthRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let jwt: jest.Mocked<JwtService>;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      register: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@example.test' }),
      findCredentials: jest.fn(),
      createSession: jest.fn().mockResolvedValue(true),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('$argon2id$hash'),
      verify: jest.fn().mockResolvedValue(true),
      dummyVerify: jest.fn().mockResolvedValue(undefined),
      needsRehash: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<PasswordService>;
    jwt = { signSession: jest.fn().mockResolvedValue('signed-jwt') } as unknown as jest.Mocked<JwtService>;
    service = new AuthService(repository, passwords, jwt);
  });

  it('normalizes identity and hashes before atomic registration persistence', async () => {
    await service.register(' Alice@Example.TEST ', 'long enough password', '127.0.0.1');

    expect(passwords.hash).toHaveBeenCalledWith('long enough password');
    expect(repository.register).toHaveBeenCalledWith(expect.objectContaining({
      email: 'alice@example.test', passwordHash: '$argon2id$hash',
    }));
  });

  it('uses the same credential error for unknown identities after dummy verification', async () => {
    repository.findCredentials.mockResolvedValue(undefined);

    await expect(service.login('missing@example.test', 'long enough password', '127.0.0.1'))
      .rejects.toMatchObject({ response: { error: { code: 'INVALID_CREDENTIALS' } }, status: 401 });
    expect(passwords.dummyVerify).toHaveBeenCalled();
  });

  it('creates the fixed 24-hour session and transaction data for successful login', async () => {
    repository.findCredentials.mockResolvedValue({
      id: 'user-1', email: 'alice@example.test', passwordHash: '$argon2id$old',
    });
    const result = await service.login('alice@example.test', 'long enough password', '127.0.0.1');

    expect(result.token).toBe('signed-jwt');
    expect(Date.parse(result.expiresAt) - Date.parse(result.issuedAt)).toBe(86_400_000);
    expect(repository.createSession).toHaveBeenCalledWith(expect.objectContaining({
      expectedPasswordHash: '$argon2id$old', user: { id: 'user-1', email: 'alice@example.test' },
    }));
  });

  it('maps the unique constraint race to a generic registration conflict', async () => {
    repository.register.mockRejectedValue(new AccountConflictError());
    await expect(service.register('alice@example.test', 'long enough password', '127.0.0.1'))
      .rejects.toMatchObject({ response: { error: { code: 'REGISTRATION_CONFLICT' } }, status: 409 });
  });

  it('bounds repeated login attempts by identity and registration attempts by address', async () => {
    repository.findCredentials.mockResolvedValue(undefined);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(service.login('missing@example.test', 'long enough password', '127.0.0.1'))
        .rejects.toMatchObject({ status: 401 });
    }
    await expect(service.login('missing@example.test', 'long enough password', '127.0.0.1'))
      .rejects.toMatchObject({ status: 429 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.register(`person-${attempt}@example.test`, 'long enough password', '127.0.0.2');
    }
    await expect(service.register('another@example.test', 'long enough password', '127.0.0.2'))
      .rejects.toMatchObject({ status: 429 });
  });
});
