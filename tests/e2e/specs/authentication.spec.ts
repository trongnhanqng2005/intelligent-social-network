import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { decodeJwt } from 'jose';
import neo4j, { type Session } from 'neo4j-driver';
import { expect, request as playwrightRequest, test, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const apiOrigin = 'http://127.0.0.1:3302';
const fixtureUserEmails = new Set<string>();
const fixtureManifests = new Map<string, string>();
const recoveryDirectory = resolve(__dirname, '../../../.artifacts/weylume/auth-recovery');
let databasePreflightPassed = false;
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
    expect(await readiness.json()).toMatchObject({ status: 'ready', database: 'isn-test', schemaVersion: 4 });
  } finally {
    await session.close();
  }

  const dev = driver.session({ database: 'isn-dev' });
  try {
    await expect(dev.run('CALL db.ping()')).rejects.toMatchObject({ code: expect.stringMatching(/^Neo\.ClientError\.Security\./) });
  } finally {
    await dev.close();
  }
  databasePreflightPassed = true;
  await recoverInterruptedFixtures();
});

test.afterAll(async () => {
  try {
    if (databasePreflightPassed) {
      const session = driver.session({ database: 'isn-test' });
      try {
        for (const email of fixtureUserEmails) {
          await cleanupOwnedAccount(session, email);
          const manifest = fixtureManifests.get(email);
          if (manifest) {
            await rm(manifest, { force: true });
            fixtureManifests.delete(email);
          }
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await driver.close();
  }
});

test('registration, duplicate rejection, login, reload restoration, logout and replay denial', async ({ page, context }) => {
  const { email, password } = await registerAccount(page);
  await expect(page.getByRole('status')).toContainText('Tạo tài khoản thành công');
  const registered = await persistedAccount(email);
  expect(registered.passwordHash.startsWith('$argon2id$')).toBe(true);
  expect(registered.passwordHash !== password).toBe(true);
  expect(registered.eventTypes).toContain('AUTH_REGISTERED');
  expect(registered.sessionCount).toBe(0);
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/auth/session`)).status()).toBe(401);
  const observer = await context.newPage();
  await observer.goto('/');
  await expect(observer.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await page.bringToFront();

  if (test.info().project.name === 'auth-desktop') {
    // Keep the combined browser run within the API's five registrations/hour per-IP budget.
    await page.getByLabel('Địa chỉ email').fill(email.toUpperCase());
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
    await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill(password);
    const duplicateResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/register');
    await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
    const duplicateResponse = await duplicateResponsePromise;
    expect(duplicateResponse.status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('Không thể tạo tài khoản');
  }

  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('mật khẩu không chính xác');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByRole('alert')).toContainText('Email hoặc mật khẩu không đúng');

  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).pressSequentially(password);
  expect(await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).evaluate((input: HTMLInputElement, expected: string) => input.value === expected, password)).toBe(true);
  let loginAttempts = 0;
  let reportLoginStarted!: () => void;
  let releaseLogin!: () => void;
  let loginReleased = false;
  const loginStarted = new Promise<void>((resolve) => { reportLoginStarted = resolve; });
  const loginGate = new Promise<void>((resolve) => { releaseLogin = resolve; });
  const releaseLoginGate = () => {
    if (loginReleased) return;
    loginReleased = true;
    releaseLogin();
  };
  await page.route('**/api/auth/login', async (route) => {
    loginAttempts += 1;
    if (loginAttempts === 1) {
      reportLoginStarted();
      await loginGate;
      await route.continue();
    } else {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"code":"SIMULATED_DUPLICATE_SUBMISSION"}}' });
    }
  });
  const loginResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/login');
  let loginStatus = 0;
  let loginBody: Record<string, unknown> = {};
  try {
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await loginStarted;
    await expect(page.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).press('Enter');
    const repeatedSubmitObserved = await page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login',
      { timeout: 750 },
    ).then(() => true, (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    });
    expect(repeatedSubmitObserved).toBe(false);
    releaseLoginGate();
    const loginResponse = await loginResponsePromise;
    loginStatus = loginResponse.status();
    loginBody = await loginResponse.json() as Record<string, unknown>;
    expect(loginAttempts).toBe(1);
  } finally {
    releaseLoginGate();
    await page.unroute('**/api/auth/login');
  }
  expect(loginStatus).toBe(200);
  expect(Object.hasOwn(loginBody, 'token')).toBe(false);
  expect(JSON.stringify(loginBody).includes(password)).toBe(false);
  const authStorageKeys = await page.evaluate(() =>
    [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /auth|token|password|session/i.test(key)));
  expect(authStorageKeys).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(observer.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toBeVisible();
  await expect(observer.getByText(email, { exact: true })).toBeVisible();
  const sessionToken = await sessionCookie(context);
  const jti = decodeJwt(sessionToken).jti;
  expect(typeof jti).toBe('string');
  const issuedCookie = (await context.cookies()).find((entry) => entry.name === 'isn_session');
  expect(issuedCookie && {
    httpOnly: issuedCookie.httpOnly,
    secure: issuedCookie.secure,
    sameSite: issuedCookie.sameSite,
  }).toEqual({ httpOnly: true, secure: false, sameSite: 'Lax' });
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
  await expect(page.getByRole('status')).toContainText('Đang kiểm tra phiên');
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toHaveCount(0);
  continueRestore();
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
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
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"unavailable"}}' }),
  );
  const failedLogoutPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/logout');
  await page.getByRole('button', { name: 'Đăng xuất' }).first().click();
  expect((await failedLogoutPromise).status()).toBe(503);
  await expect(page.getByRole('alert')).toContainText('Không thể đăng xuất lúc này.');
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử đăng xuất lại' })).toBeVisible();
  await page.unroute('**/api/auth/logout');
  let logoutAttempts = 0;
  let reportLogoutStarted!: () => void;
  let releaseLogout!: () => void;
  let logoutReleased = false;
  const logoutStarted = new Promise<void>((resolve) => { reportLogoutStarted = resolve; });
  const logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve; });
  const releaseLogoutGate = () => {
    if (logoutReleased) return;
    logoutReleased = true;
    releaseLogout();
  };
  await page.route('**/api/auth/logout', async (route) => {
    logoutAttempts += 1;
    if (logoutAttempts === 1) {
      reportLogoutStarted();
      await logoutGate;
      await route.continue();
    } else {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"code":"SIMULATED_DUPLICATE_SUBMISSION"}}' });
    }
  });
  const logoutResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/logout');
  let logoutStatus = 0;
  try {
    await page.getByRole('button', { name: 'Thử đăng xuất lại' }).dblclick();
    await logoutStarted;
    const duplicateLogoutObserved = await page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/logout',
      { timeout: 750 },
    ).then(() => true, (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    });
    expect(duplicateLogoutObserved).toBe(false);
    releaseLogoutGate();
    const logoutResponse = await logoutResponsePromise;
    logoutStatus = logoutResponse.status();
    expect(logoutAttempts).toBe(1);
  } finally {
    releaseLogoutGate();
    await page.unroute('**/api/auth/logout');
  }
  expect(logoutStatus).toBe(204);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await expect(observer.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await observer.reload();
  await expect(observer.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  expect((await observer.request.get(`${apiOrigin}/auth/session`)).status()).toBe(401);
  const revoked = await sessionState(String(jti));
  expect(revoked.revokedAt).toBeTruthy();
  expect(revoked.eventTypes).toContain('AUTH_LOGOUT');
  const replayContext = await playwrightRequest.newContext();
  try {
    const originalCookieReplay = await replayContext.get(`${apiOrigin}/auth/session`, {
      headers: { Cookie: `isn_session=${sessionToken}` },
    });
    expect(originalCookieReplay.status()).toBe(401);
  } finally {
    await replayContext.dispose();
  }
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
  await expect(page.locator('#auth-password-error')).toContainText('15 đến 128');

  await page.getByLabel('Địa chỉ email').fill('not-an-email');
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('short');
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill('short');
  const invalidResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await invalidResponse).status()).toBe(422);
  await expect(page.locator('#email-error')).toContainText('địa chỉ email hợp lệ');

  await page.getByLabel('Địa chỉ email').fill(validationEmail);
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill('short');
  const invalidPassword = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  expect((await invalidPassword).status()).toBe(422);
  await expect(page.locator('#auth-password-error')).toContainText('15 đến 128');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Mật khẩu', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('textbox', { name: 'Mật khẩu', exact: true })).toHaveAttribute('aria-describedby', /auth-password-error/);

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
  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

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
  await expect(page.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/auth/session`)).status()).toBe(401);
});

test('registration is keyboard accessible and fits a narrow responsive viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/dang-ky');
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Minh họa những kết nối trong cộng đồng' })).toHaveCount(0);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  const skipLink = page.getByRole('link', { name: 'Đi đến biểu mẫu' });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '3px' });

  const emailInput = page.getByRole('textbox', { name: 'Địa chỉ email' });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await emailInput.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(emailInput).toBeFocused();
  await expect(page.getByLabel('Địa chỉ email')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByRole('textbox', { name: 'Mật khẩu', exact: true })).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByRole('textbox', { name: 'Xác nhận mật khẩu' })).toHaveAttribute('autocomplete', 'new-password');
  const password = page.getByRole('textbox', { name: 'Mật khẩu', exact: true });
  await page.getByRole('button', { name: 'Hiện mật khẩu' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('shows retryable unavailable state after simulated interruption and recovers against the real API', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByText('Chưa thể xác minh phiên đăng nhập.', { exact: true })).toBeVisible();
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.getByText('Chưa thể xác minh phiên đăng nhập.', { exact: true })).toHaveCount(0);
});

async function registerAccount(page: Page): Promise<{ email: string; password: string }> {
  const email = `auth-${randomUUID()}@example.invalid`;
  const password = '🔐'.repeat(100);
  // Persist ownership before any registration request so a terminated run can recover this exact synthetic account.
  fixtureUserEmails.add(email);
  const manifest = await recordFixtureOwnership(email);
  fixtureManifests.set(email, manifest);
  await page.goto('/dang-ky');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).pressSequentially(password);
  expect(await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).evaluate((input: HTMLInputElement, expected: string) => input.value === expected, password)).toBe(true);

  let mismatchedRegistrationRequests = 0;
  const countMismatchedMutation = (request: { url(): string }) => {
    if (new URL(request.url()).pathname === '/api/auth/register') mismatchedRegistrationRequests += 1;
  };
  page.on('request', countMismatchedMutation);
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill(`${password}x`);
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  await expect(page.getByRole('alert')).toContainText('Mật khẩu xác nhận chưa khớp.');
  await expect(page.getByRole('alert')).toBeFocused();
  expect(mismatchedRegistrationRequests).toBe(0);
  expect(await accountCountFor(email)).toBe(0);
  page.off('request', countMismatchedMutation);

  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill(password);
  let registrationAttempts = 0;
  let reportRegistrationStarted!: () => void;
  let releaseRegistration!: () => void;
  let released = false;
  const registrationStarted = new Promise<void>((resolve) => { reportRegistrationStarted = resolve; });
  const registrationGate = new Promise<void>((resolve) => { releaseRegistration = resolve; });
  const releaseGate = () => {
    if (released) return;
    released = true;
    releaseRegistration();
  };
  const isRegistration = (url: string) => new URL(url).pathname === '/api/auth/register';
  await page.route('**/api/auth/register', async (route) => {
    registrationAttempts += 1;
    if (registrationAttempts === 1) {
      reportRegistrationStarted();
      await registrationGate;
      await route.continue();
      return;
    }
    await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"code":"SIMULATED_DUPLICATE_SUBMISSION"}}' });
  });
  const responsePromise = page.waitForResponse((response) => isRegistration(response.url()));
  try {
    await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
    await registrationStarted;
    await expect(page.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).press('Enter');
    const repeatedSubmitObserved = await page.waitForRequest(
      (request) => request.method() === 'POST' && isRegistration(request.url()),
      { timeout: 750 },
    ).then(() => true, (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    });
    releaseGate();
    const response = await responsePromise;
    const body = await response.json();
    const payload = JSON.parse(response.request().postData() ?? '{}') as Record<string, unknown>;

    expect(repeatedSubmitObserved).toBe(false);
    expect(registrationAttempts).toBe(1);
    expect(response.status()).toBe(201);
    expect(Object.keys(payload).sort()).toEqual(['email', 'password']);
    expect(payload.email === email).toBe(true);
    expect(payload.password === password).toBe(true);
    expect(Object.hasOwn(body, 'token')).toBe(false);
    expect(JSON.stringify(body).includes(password)).toBe(false);
    expect(body.user.email).toBe(email);
  } finally {
    releaseGate();
    await page.unroute('**/api/auth/register');
  }

  await expect(page.getByLabel('Địa chỉ email')).toHaveValue(email);
  await expect(page.getByRole('textbox', { name: 'Mật khẩu', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Xác nhận mật khẩu' })).toHaveValue('');
  return { email, password };
}

async function accountCountFor(email: string): Promise<number> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run('MATCH (user:User {email: $email}) RETURN count(user) AS count', { email });
    return result.records[0]?.get('count').toNumber() ?? 0;
  } finally {
    await session.close();
  }
}

async function recordFixtureOwnership(email: string): Promise<string> {
  const manifest = resolve(recoveryDirectory, `auth-account-${process.pid}-${randomUUID()}.json`);
  await mkdir(recoveryDirectory, { recursive: true });
  await writeFile(manifest, JSON.stringify({ version: 1, pid: process.pid, email }), { flag: 'wx' });
  return manifest;
}

async function recoverInterruptedFixtures(): Promise<void> {
  await mkdir(recoveryDirectory, { recursive: true });
  const session = driver.session({ database: 'isn-test' });
  try {
    for (const name of await readdir(recoveryDirectory)) {
      if (!/^auth-account-\d+-[0-9a-f-]{36}\.json$/.test(name)) continue;
      const manifestPath = resolve(recoveryDirectory, name);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: unknown; pid?: unknown; email?: unknown };
      if (manifest.version !== 1 || !Number.isSafeInteger(manifest.pid) || typeof manifest.email !== 'string'
        || !/^auth-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.invalid$/.test(manifest.email)) {
        throw new Error('An auth recovery manifest is invalid; stopping before test writes.');
      }
      if (processIsAlive(manifest.pid as number)) continue;
      await cleanupOwnedAccount(session, manifest.email);
      await rm(manifestPath);
    }
  } finally {
    await session.close();
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

async function cleanupOwnedAccount(session: Session, email: string): Promise<void> {
  const owned = await session.run('MATCH (user:User {email: $email}) RETURN user.id AS id', { email });
  for (const record of owned.records) {
    const userId = record.get('id');
    if (typeof userId !== 'string') throw new Error('Synthetic test account ownership lookup failed.');
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
  const remaining = await session.run('MATCH (user:User {email: $email}) RETURN count(user) AS count', { email });
  if (remaining.records[0]?.get('count').toNumber() !== 0) {
    throw new Error('Synthetic test account cleanup could not be verified.');
  }
}

async function persistedAccount(email: string): Promise<{ passwordHash: string; eventTypes: string[]; sessionCount: number }> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (user:User {email: $email})
       OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
       WITH user, collect(DISTINCT event.eventType) AS eventTypes
       OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
       RETURN user.passwordHash AS passwordHash, eventTypes, count(DISTINCT authSession) AS sessionCount`,
      { email },
    );
    const record = result.records[0];
    if (!record) throw new Error('Synthetic registration fixture was not persisted.');
    return {
      passwordHash: String(record.get('passwordHash')),
      eventTypes: [...record.get('eventTypes')],
      sessionCount: record.get('sessionCount').toNumber(),
    };
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
