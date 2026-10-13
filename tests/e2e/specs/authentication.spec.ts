import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import neo4j from 'neo4j-driver';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:3302';
const fixtureUserIds = new Set<string>();
const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME!, process.env.NEO4J_TEST_PASSWORD!),
);

test.beforeAll(async () => {
  await driver.verifyConnectivity();
  const session = driver.session({ database: 'isn-test' });
  try {
    const identity = await session.run('CALL db.info() YIELD name RETURN name');
    const user = await session.run('CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles');
    expect(identity.records[0]?.get('name')).toBe('isn-test');
    expect(user.records[0]?.get('username')).toBe('isn_test_runner');
    expect([...user.records[0]!.get('roles')].sort()).toEqual(['PUBLIC', 'isn_test_runner_role']);
    const readiness = await fetch(`${apiOrigin}/ready`);
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({ status: 'ready', database: 'isn-test', schemaVersion: 2 });
  } finally {
    await session.close();
  }

  const dev = driver.session({ database: 'isn-dev' });
  try {
    await expect(dev.run('CALL db.ping()')).rejects.toMatchObject({ code: expect.stringMatching(/^Neo\.ClientError\.Security\./) });
  } finally {
    await dev.close();
  }
});

test.afterAll(async () => {
  const session = driver.session({ database: 'isn-test' });
  try {
    for (const userId of fixtureUserIds) {
      await session.executeWrite((tx) => tx.run(
        `MATCH (user:User {id: $userId})
         OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
         OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
         WITH user, collect(DISTINCT authSession) AS sessions, collect(DISTINCT event) AS events
         UNWIND [user] + [item IN sessions WHERE item IS NOT NULL] + [item IN events WHERE item IS NOT NULL] AS owned
         DETACH DELETE owned`,
        { userId },
      ));
    }
  } finally {
    await session.close();
    await driver.close();
  }
});

test('registration, duplicate rejection, login, reload restoration, logout and replay denial', async ({ page, context }) => {
  const { email, password } = await registerAccount(page);
  await expect(page.getByRole('status')).toContainText('Tạo tài khoản thành công');
  const registered = await persistedAccount(email);
  expect(registered.passwordHash).toMatch(/^\$argon2id\$/);
  expect(registered.passwordHash).not.toBe(password);
  expect(registered.eventTypes).toContain('AUTH_REGISTERED');
  const observer = await context.newPage();
  await observer.goto('/');
  await expect(observer.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await page.bringToFront();

  if (test.info().project.name === 'auth-desktop') {
    // Keep the combined browser run within the API's five registrations/hour per-IP budget.
    await page.getByLabel('Địa chỉ email').fill(email.toUpperCase());
    await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
    const duplicateResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/register');
    await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
    const duplicateResponse = await duplicateResponsePromise;
    expect(duplicateResponse.status(), JSON.stringify(await duplicateResponse.json())).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Không thể tạo tài khoản');
  }

  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill('mật khẩu không chính xác');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng');

  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill('');
  await page.getByRole('textbox', { name: 'Mật khẩu' }).pressSequentially(password);
  await expect(page.getByRole('textbox', { name: 'Mật khẩu' })).toHaveValue(password);
  const loginResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/login');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  const loginBody = await loginResponse.json();
  expect(loginBody).not.toHaveProperty('token');
  expect(JSON.stringify(loginBody)).not.toContain(password);
  const authStorageKeys = await page.evaluate(() =>
    [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /auth|token|password|session/i.test(key)));
  expect(authStorageKeys).toEqual([]);
  await expect(page.getByRole('heading', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  await expect(observer.getByRole('heading', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  const sessionToken = await sessionCookie(context);
  const jti = decodeJwt(sessionToken).jti;
  expect(typeof jti).toBe('string');
  const issuedCookie = (await context.cookies()).find((entry) => entry.name === 'isn_session');
  expect(issuedCookie).toMatchObject({ httpOnly: true, secure: false, sameSite: 'Lax' });
  expect(issuedCookie?.expires).toBeGreaterThan(Date.now() / 1000);

  let continueRestore!: () => void;
  let reportRestoreStarted!: () => void;
  const restoreGate = new Promise<void>((resolve) => { continueRestore = resolve; });
  const restoreStarted = new Promise<void>((resolve) => { reportRestoreStarted = resolve; });
  await page.route('**/api/auth/session', async (route) => {
    reportRestoreStarted();
    await restoreGate;
    await route.continue();
  });
  await page.reload();
  await restoreStarted;
  await expect(page.getByRole('heading', { name: 'Đang kiểm tra phiên của bạn…' })).toBeVisible();
  continueRestore();
  await expect(page.getByRole('heading', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  await page.unroute('**/api/auth/session');
  expect((await page.request.get(`${apiOrigin}/auth/session`)).status()).toBe(200);

  const csrfResponse = await page.request.get(`${apiOrigin}/auth/csrf`);
  expect(csrfResponse.status()).toBe(200);
  const csrfToken = (await csrfResponse.json()).csrfToken as string;
  const csrfHeaders = { Origin: 'http://127.0.0.1:5175', 'X-CSRF-Token': csrfToken };
  expect((await page.request.post(`${apiOrigin}/auth/register`, {
    headers: { Origin: 'http://attacker.invalid', 'X-CSRF-Token': csrfToken },
    data: { email, password },
  })).status()).toBe(403);
  expect((await page.request.post(`${apiOrigin}/auth/register`, {
    headers: { Origin: 'http://127.0.0.1:5175' }, data: { email, password },
  })).status()).toBe(403);
  expect((await page.request.post(`${apiOrigin}/auth/register`, {
    headers: { ...csrfHeaders, 'X-CSRF-Token': 'forged-token' }, data: { email, password },
  })).status()).toBe(403);
  const logoutResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/logout');
  await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
  expect((await logoutResponsePromise).status()).toBe(204);
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await expect(observer.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await observer.reload();
  await expect(observer.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  expect((await observer.request.get(`${apiOrigin}/auth/session`)).status()).toBe(401);
  const revoked = await sessionState(String(jti));
  expect(revoked.revokedAt).toBeTruthy();
  expect(revoked.eventTypes).toContain('AUTH_LOGOUT');
  const anonymousCsrf = await page.request.get(`${apiOrigin}/auth/csrf`);
  const repeatedLogout = await page.request.post(`${apiOrigin}/auth/logout`, {
    headers: { Origin: 'http://127.0.0.1:5175', 'X-CSRF-Token': (await anonymousCsrf.json()).csrfToken },
  });
  expect(repeatedLogout.status()).toBe(204);
  await observer.close();
  const replay = await page.request.get(`${apiOrigin}/auth/session`);
  expect(replay.status()).toBe(401);

  const session = driver.session({ database: 'isn-test' });
  try {
    const events = await session.run(
      `MATCH (user:User {email: $email})-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
       RETURN collect(event.eventType) AS types`,
      { email },
    );
    expect([...events.records[0]!.get('types')].sort()).toEqual([
      'AUTH_LOGIN_FAILED', 'AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_REGISTERED',
    ]);
  } finally {
    await session.close();
  }
});

test('registration validation shows Vietnamese required and invalid-field feedback without persistence', async ({ page }) => {
  await page.goto('/dang-ky');
  const requiredResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await requiredResponse).status()).toBe(422);
  await expect(page.locator('#email-error')).toContainText('địa chỉ email hợp lệ');

  const validationEmail = `validation-${randomUUID()}@example.invalid`;
  await page.getByLabel('Địa chỉ email').fill(validationEmail);
  const missingPassword = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await missingPassword).status()).toBe(422);
  await expect(page.locator('#password-error')).toContainText('15 đến 128');

  await page.getByLabel('Địa chỉ email').fill('not-an-email');
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill('short');
  const invalidResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await invalidResponse).status()).toBe(422);
  await expect(page.locator('#email-error')).toContainText('địa chỉ email hợp lệ');

  await page.getByLabel('Địa chỉ email').fill(validationEmail);
  const invalidPassword = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await invalidPassword).status()).toBe(422);
  await expect(page.locator('#password-error')).toContainText('15 đến 128');

  const session = driver.session({ database: 'isn-test' });
  try {
    const absentValidEmail = await session.run('MATCH (user:User {email: $email}) RETURN count(user) AS count', { email: validationEmail });
    expect(absentValidEmail.records[0]?.get('count').toNumber()).toBe(0);
    const absent = await session.run("MATCH (user:User) WHERE user.email = 'not-an-email' RETURN count(user) AS count");
    expect(absent.records[0]?.get('count').toNumber()).toBe(0);
  } finally {
    await session.close();
  }
});

test('expired Neo4j session is rejected on restoration and returns the browser to anonymous state', async ({ page, context }) => {
  const { email, password } = await registerAccount(page);
  fixtureUserIds.add(await userIdFor(email));
  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).fill(password);
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByRole('heading', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();

  const jti = decodeJwt(await sessionCookie(context)).jti;
  const session = driver.session({ database: 'isn-test' });
  try {
    const expired = await session.run(
      `MATCH (authSession:AuthSession {jti: $jti})
       SET authSession.expiresAt = datetime() - duration('PT1S')
       RETURN count(authSession) AS updated`,
      { jti },
    );
    expect(expired.records[0]?.get('updated').toNumber()).toBe(1);
  } finally {
    await session.close();
  }

  await page.reload();
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/auth/session`)).status()).toBe(401);
});

test('forms are keyboard accessible and fit a narrow responsive viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/dang-ky');
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Minh họa những kết nối trong cộng đồng' })).toHaveCount(0);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const activeLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.getAttribute('id'));
  expect(['auth-email', 'auth-password', 'auth-title']).toContain(activeLabel);
  await expect(page.getByLabel('Địa chỉ email')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByRole('textbox', { name: 'Mật khẩu' })).toHaveAttribute('autocomplete', 'new-password');
});

test('shows retryable unavailable state after simulated interruption and recovers against the real API', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByText('Dịch vụ đăng nhập hiện chưa khả dụng. Vui lòng thử lại.', { exact: true })).toBeVisible();
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Thử kết nối lại' }).click();
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByText('Dịch vụ đăng nhập hiện chưa khả dụng. Vui lòng thử lại.', { exact: true })).toHaveCount(0);
});

async function registerAccount(page: Page): Promise<{ email: string; password: string }> {
  const email = `auth-${randomUUID()}@example.invalid`;
  const password = '🔐'.repeat(100);
  await page.goto('/dang-ky');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu' }).pressSequentially(password);
  await expect(page.getByRole('textbox', { name: 'Mật khẩu' })).toHaveValue(password);
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body).not.toHaveProperty('token');
  expect(JSON.stringify(body)).not.toContain(password);
  expect(body.user.email).toBe(email);
  fixtureUserIds.add(body.user.id);
  return { email, password };
}

async function userIdFor(email: string): Promise<string> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run('MATCH (user:User {email: $email}) RETURN user.id AS id', { email });
    const id = result.records[0]?.get('id');
    if (typeof id !== 'string') throw new Error('Synthetic test account ownership lookup failed.');
    return id;
  } finally {
    await session.close();
  }
}

async function persistedAccount(email: string): Promise<{ passwordHash: string; eventTypes: string[] }> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (user:User {email: $email})-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
       RETURN user.passwordHash AS passwordHash, collect(event.eventType) AS eventTypes`,
      { email },
    );
    const record = result.records[0];
    if (!record) throw new Error('Synthetic registration fixture was not persisted.');
    return { passwordHash: String(record.get('passwordHash')), eventTypes: [...record.get('eventTypes')] };
  } finally {
    await session.close();
  }
}

async function sessionState(jti: string): Promise<{ revokedAt: string | null; eventTypes: string[] }> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (authSession:AuthSession {jti: $jti})
       OPTIONAL MATCH (user:User)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent {sessionId: authSession.id})
       RETURN toString(authSession.revokedAt) AS revokedAt, collect(event.eventType) AS eventTypes`,
      { jti },
    );
    const record = result.records[0];
    if (!record) throw new Error('Synthetic session fixture was not persisted.');
    const revokedAt = record.get('revokedAt');
    return { revokedAt: typeof revokedAt === 'string' ? revokedAt : null, eventTypes: [...record.get('eventTypes')] };
  } finally {
    await session.close();
  }
}

async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((entry) => entry.name === 'isn_session');
  if (!cookie) throw new Error('Expected HttpOnly authentication session cookie was not issued.');
  return cookie.value;
}
