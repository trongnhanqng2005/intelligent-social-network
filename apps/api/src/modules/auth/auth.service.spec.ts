import { ConfigService } from '@nestjs/config';
import { DEMO_ADMIN, DEMO_PASSWORD } from '../../social-demo/accounts.js';
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
      findActiveSession: jest.fn(),
      createSession: jest.fn().mockResolvedValue(true),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('$argon2id$hash'),
      verify: jest.fn().mockResolvedValue(true),
      dummyVerify: jest.fn().mockResolvedValue(undefined),
      needsRehash: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<PasswordService>;
    jwt = { signSession: jest.fn().mockResolvedValue('signed-jwt'), verifySessionToken: jest.fn() } as unknown as jest.Mocked<JwtService>;
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
      id: 'user-1', email: 'alice@example.test', passwordHash: '$argon2id$old', accountLocked: false,
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

  it.each([
    ['production', '127.0.0.1', false],
    ['development', '0.0.0.0', false],
    ['development', '127.0.0.1', true],
  ])('permits demo login and session restoration only for local development (%s, %s)', async (environment, host, allowed) => {
    const values: Record<string, string> = {
      NODE_ENV: environment, HOST: host, NEO4J_DATABASE: 'isn-dev',
      NEO4J_URI: 'bolt://127.0.0.1:7687', AUTH_WEB_ORIGIN: 'http://localhost:5173',
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    service = new AuthService(repository, passwords, jwt, config);
    const account = { id: 'demo-admin', email: DEMO_ADMIN.email, role: 'ADMIN', localDemo: true } as const;
    repository.findCredentials.mockResolvedValue({ ...account, accountLocked: false, passwordHash: 'demo-hash' });
    repository.findActiveSession.mockResolvedValue({ ...account, expiresAt: '2026-11-20T00:00:00Z' });
    jwt.verifySessionToken.mockResolvedValue({ sub: account.id, jti: 'demo-jti', exp: 1_800_000_000 } as never);

    const login = service.login(account.email, DEMO_PASSWORD, '127.0.0.1');
    const session = service.restoreSession('session-token');
    if (allowed) {
      await expect(login).resolves.toMatchObject({ user: { role: 'ADMIN' } });
      await expect(session).resolves.toMatchObject({ user: { role: 'ADMIN' } });
    } else {
      await expect(login).rejects.toMatchObject({ status: 401 });
      await expect(session).resolves.toBeUndefined();
      expect(repository.createSession).not.toHaveBeenCalled();
    }
  });

  it('rejects public registration with the shared demo account credential', async () => {
    await expect(service.register(DEMO_ADMIN.email, DEMO_PASSWORD, '127.0.0.1'))
      .rejects.toMatchObject({ status: 409 });
    expect(repository.register).not.toHaveBeenCalled();
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
