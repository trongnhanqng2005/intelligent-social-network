import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { resolve } from 'node:path';
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';

const apiOrigin = 'http://127.0.0.1:3305';
const webOrigin = 'http://127.0.0.1:5178';
const recoveryDirectory = resolve('.artifacts/weylume/profile-acceptance-recovery');
const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME!, process.env.NEO4J_TEST_PASSWORD!),
);
const ownedAccounts = new Map<string, { userId?: string; manifest: string }>();
let initialCounts: Counts | undefined;
let acceptanceBaseline: Counts | undefined;
let databasePreflightPassed = false;

type Counts = { users: number; sessions: number; events: number };
type Account = {
  email: string;
  password: string;
  userId: string;
  csrfToken: string;
  api: APIRequestContext;
};
type FixtureManifest = { version: 1; pid: number; email: string; userId?: string };

test.beforeAll(async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NEO4J_DATABASE, 'isn-test');
  assert.ok(process.env.NEO4J_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD);
  assert.ok(!process.env.NEO4J_USERNAME && !process.env.NEO4J_PASSWORD);

  await driver.verifyConnectivity();
  const session = driver.session({ database: 'isn-test' });
  try {
    const identity = await session.run('CALL db.info() YIELD name, id RETURN name, id');
    const principal = await session.run(
      'CALL dbms.showCurrentUser() YIELD username, roles RETURN username, roles',
    );
    expect(identity.records[0]?.get('name')).toBe('isn-test');
    expect(typeof identity.records[0]?.get('id')).toBe('string');
    expect(principal.records[0]?.get('username')).toBe('isn_test_runner');
    expect([...principal.records[0].get('roles')].sort()).toEqual(['PUBLIC', 'isn_test_runner_role']);

    const deniedDev = driver.session({ database: 'isn-dev' });
    try {
      await expect(deniedDev.run('CALL db.ping()')).rejects.toMatchObject({
        code: expect.stringMatching(/^Neo\.ClientError\.Security\./u),
      });
    } finally {
      await deniedDev.close();
    }

    const history = await session.run(
      `MATCH (migration:ISNSchemaMigration)
       RETURN migration.version AS version, migration.name AS name,
              migration.checksum AS checksum, migration.status AS status,
              migration.appliedAt IS NOT NULL AS applied,
              migration.verifiedAt IS NOT NULL AS verified ORDER BY version`,
    );
    expect(history.records.map((record) => [
      asNumber(record.get('version')), record.get('name'), record.get('checksum'),
      record.get('status'), record.get('applied'), record.get('verified'),
    ])).toEqual([
      [1, 'foundation-schema-marker', 'e5b57d614d5384d465c77a9e5143076986fdb11178c7ed9278b2bbf4c7af44d2', 'VERIFIED', true, true],
      [2, 'authentication-schema', 'ce22db8398514d8caa2c9d93a7107750c84507af737decb9a5a001b5311137de', 'VERIFIED', true, true],
      [3, 'user-profile-discovery', 'd21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee', 'VERIFIED', true, true],
      [4, 'friendship-system', '65d7c6b62a29360b77606ef4c26b73b56c55dd7a8343d47df716e318a04988f2', 'VERIFIED', true, true],
    ]);
    const marker = await session.run(
      "MATCH (schema:ISNSchema {key:'application'}) RETURN schema.version AS version LIMIT 1",
    );
    expect(asNumber(marker.records[0]?.get('version'))).toBe(4);

    const expectedConstraints = [
      ['isn_schema_metadata_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchema', ['key']],
      ['isn_schema_migration_version', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'ISNSchemaMigration', ['version']],
      ['isn_user_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['id']],
      ['isn_user_email', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'User', ['email']],
      ['isn_auth_session_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['id']],
      ['isn_auth_session_jti', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthSession', ['jti']],
      ['isn_auth_event_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'AuthActivityEvent', ['eventId']],
      ['isn_friendship_pair_key', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['pairKey']],
      ['isn_friendship_request_id', 'NODE_PROPERTY_UNIQUENESS', 'NODE', 'FriendshipPair', ['requestId']],
      ['isn_friendship_id', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
      ['isn_friendship_edge_pair_key', 'RELATIONSHIP_PROPERTY_UNIQUENESS', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
    ];
    const constraints = await session.run(
      'SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties',
    );
    expect(constraints.records).toHaveLength(expectedConstraints.length);
    for (const [name, type, entityType, label, properties] of expectedConstraints) {
      expect(constraints.records.some((record) => record.get('name') === name &&
        record.get('type') === type && record.get('entityType') === entityType &&
        JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
        JSON.stringify(record.get('properties')) === JSON.stringify(properties))).toBe(true);
    }

    const expectedIndexes = [
      ['isn_auth_event_id', 'RANGE', 'NODE', 'AuthActivityEvent', ['eventId']],
      ['isn_auth_session_id', 'RANGE', 'NODE', 'AuthSession', ['id']],
      ['isn_auth_session_jti', 'RANGE', 'NODE', 'AuthSession', ['jti']],
      ['isn_auth_session_expires_at', 'RANGE', 'NODE', 'AuthSession', ['expiresAt']],
      ['isn_auth_event_timestamp', 'RANGE', 'NODE', 'AuthActivityEvent', ['timestamp']],
      ['isn_schema_metadata_key', 'RANGE', 'NODE', 'ISNSchema', ['key']],
      ['isn_schema_migration_version', 'RANGE', 'NODE', 'ISNSchemaMigration', ['version']],
      ['isn_user_email', 'RANGE', 'NODE', 'User', ['email']],
      ['isn_user_id', 'RANGE', 'NODE', 'User', ['id']],
      ['isn_user_display_name_search', 'TEXT', 'NODE', 'User', ['displayNameSearch']],
      ['isn_friendship_pair_key', 'RANGE', 'NODE', 'FriendshipPair', ['pairKey']],
      ['isn_friendship_request_id', 'RANGE', 'NODE', 'FriendshipPair', ['requestId']],
      ['isn_friendship_id', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['id']],
      ['isn_friendship_edge_pair_key', 'RANGE', 'RELATIONSHIP', 'FRIEND_WITH', ['pairKey']],
      ['isn_friendship_requests_sent', 'RANGE', 'NODE', 'FriendshipPair', ['senderId', 'requestStatus', 'requestId']],
      ['isn_friendship_requests_received', 'RANGE', 'NODE', 'FriendshipPair', ['recipientId', 'requestStatus', 'requestId']],
    ];
    const readiness = await session.run(
      'SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state',
    );
    const applicationIndexes = readiness.records.filter((record) => record.get('type') !== 'LOOKUP');
    expect(applicationIndexes).toHaveLength(expectedIndexes.length);
    for (const [name, type, entityType, label, properties] of expectedIndexes) {
      expect(applicationIndexes.some((record) => record.get('name') === name &&
        record.get('type') === type && record.get('entityType') === entityType &&
        JSON.stringify(record.get('labelsOrTypes')) === JSON.stringify([label]) &&
        JSON.stringify(record.get('properties')) === JSON.stringify(properties) &&
        record.get('state') === 'ONLINE')).toBe(true);
    }

    const invalidProfiles = await session.run(
      `MATCH (user:User)
       WHERE user.id IS NULL OR user.displayName IS NULL OR size(user.displayName) < 2 OR size(user.displayName) > 80 OR
             user.displayNameSearch IS NULL OR user.profileCreatedAt IS NULL OR user.profileUpdatedAt IS NULL OR
             user.profileVersion IS NULL OR user.profileVersion < 0
       RETURN count(user) AS invalidProfiles`,
    );
    expect(asNumber(invalidProfiles.records[0]?.get('invalidProfiles'))).toBe(0);
    initialCounts = await readCounts(session);
  } finally {
    await session.close();
  }

  const [apiReady, proxiedReady] = await Promise.all([
    fetch(`${apiOrigin}/ready`),
    fetch(`${webOrigin}/api/ready`),
  ]);
  expect(apiReady.status).toBe(200);
  expect(await apiReady.json()).toMatchObject({ status: 'ready', database: 'isn-test', schemaVersion: 4 });
  expect(proxiedReady.status).toBe(200);
  expect(await proxiedReady.json()).toMatchObject({ status: 'ready', database: 'isn-test', schemaVersion: 4 });
  databasePreflightPassed = true;

  console.log(JSON.stringify({
    scenario: 'UPD-00', database: 'isn-test', principal: 'isn_test_runner',
    rolesVerified: true, devAccess: 'denied', migrations: 'V1-V4 VERIFIED',
    schemaVersion: 4, profileIndex: 'ONLINE', apiReady: true, viteProxyReady: true,
    baseline: initialCounts,
  }));
});

test.afterAll(async () => {
  let cleanupFailure: unknown;
  try {
    if (databasePreflightPassed) {
      const session = driver.session({ database: 'isn-test' });
      try {
        for (const [email, fixture] of ownedAccounts) {
          const removed = await cleanupOwnedAccount(session, email, fixture.userId);
          if (fixture.userId && removed.users !== 1) {
            throw new Error('Fixture cleanup did not remove the verified run-owned account');
          }
          await rm(fixture.manifest, { force: true });
        }
        if (acceptanceBaseline) {
          const remaining = await readCounts(session);
          assert.deepEqual(remaining, acceptanceBaseline, 'Only this run-owned fixture records may be removed');
        }
      } finally {
        await session.close();
      }
    }
  } catch (error) {
    cleanupFailure = error;
  } finally {
    await driver.close();
  }
  if (cleanupFailure) throw cleanupFailure;
});

test('UPD-01–08 real-stack profile, discovery, privacy, concurrency and recovery acceptance', async ({ page, browser }) => {
  assert.ok(databasePreflightPassed, 'UPD-00 must pass before test fixtures can be created or recovered');
  await recoverInterruptedFixtures();
  const session = driver.session({ database: 'isn-test' });
  try {
    acceptanceBaseline = await readCounts(session);
  } finally {
    await session.close();
  }

  const marker = `upd${randomUUID().slice(0, 8)}`;
  const emailOnly = randomUUID();
  const bioOnly = `bioonly${randomUUID().slice(0, 8)}`;
  const locationOnly = `locationonly${randomUUID().slice(0, 8)}`;
  const owner = await registerThroughUI(page);
  const memberOne = await registerThroughApi({
    displayName: `Nguyễn ${marker} An`,
    bio: `Giới thiệu ${bioOnly}`,
    location: 'Đà Nẵng',
    emailPrefix: `profile-${emailOnly}`,
  });
  const memberTwo = await registerThroughApi({
    displayName: `Đặng ${marker} Bình`,
    bio: `Mình yêu văn hóa Việt Nam. ${'Thích đọc sách và viết nhật ký. '.repeat(6)}`,
    location: `Huế ${locationOnly}`,
  });

  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(owner.email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(owner.password);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/login');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await page.goto('/ho-so');
  await expect(page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Hồ sơ của tôi' })).toBeVisible();

  const ownerRemote = await loginViaApi(owner.email, owner.password);
  const beforeReads = await readOwnerState(owner.userId);
  const beforeCounts = await readCurrentCounts();
  const firstRead = await page.request.get('/api/users/me/profile');
  const secondRead = await page.request.get('/api/users/me/profile');
  expect(firstRead.status()).toBe(200);
  expect(secondRead.status()).toBe(200);
  expect(firstRead.headers()['cache-control']).toContain('no-store');
  expect((await firstRead.json()).profile).toMatchObject({
    id: owner.userId,
    displayName: `Thành viên ${owner.userId.slice(0, 8)}`,
    bio: null,
    location: null,
    version: 0,
  });
  expect(await readOwnerState(owner.userId)).toEqual(beforeReads);
  expect(await readCurrentCounts()).toEqual(beforeCounts);

  await page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Hồ sơ của tôi' }).click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
  await expect(page.getByText(`Thành viên ${owner.userId.slice(0, 8)}`)).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Tên hiển thị').fill('Nguyễn Thị Ánh 🌿');
  await page.getByLabel('Giới thiệu').fill('Mình yêu Đà Nẵng.\nĐọc sách và viết mỗi ngày.');
  await page.getByLabel('Địa điểm').fill('Đà Nẵng');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');
  let persisted = await readOwnerState(owner.userId);
  expect(persisted).toMatchObject({
    displayName: 'Nguyễn Thị Ánh 🌿',
    bio: 'Mình yêu Đà Nẵng.\nĐọc sách và viết mỗi ngày.',
    location: 'Đà Nẵng',
    version: 1,
  });
  expect(persisted.auth).toEqual(beforeReads.auth);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nguyễn Thị Ánh 🌿' })).toBeVisible();
  await expect(page.getByText('Mình yêu Đà Nẵng.')).toBeVisible();

  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Tên hiển thị').fill('Bản nháp sẽ hủy');
  let cancelPatches = 0;
  const countCancelPatch = (request: { method(): string; url(): string }) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me/profile') cancelPatches += 1;
  };
  page.on('request', countCancelPatch);
  await page.getByRole('button', { name: 'Hủy' }).click();
  page.off('request', countCancelPatch);
  expect(cancelPatches).toBe(0);
  await expect(page.getByRole('heading', { name: 'Nguyễn Thị Ánh 🌿' })).toBeVisible();
  expect((await readOwnerState(owner.userId)).version).toBe(1);

  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Giới thiệu').fill('');
  await page.getByLabel('Địa điểm').fill('');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');
  persisted = await readOwnerState(owner.userId);
  expect(persisted.bio).toBeNull();
  expect(persisted.location).toBeNull();
  expect(persisted.bioPropertyAbsent).toBe(true);
  expect(persisted.locationPropertyAbsent).toBe(true);
  expect(persisted.version).toBe(2);

  const anonymousContext = await browser.newContext({ baseURL: webOrigin });
  try {
    const anonymousProfile = await anonymousContext.request.get('/api/users/me/profile');
    const anonymousDirectory = await anonymousContext.request.get('/api/users');
    const anonymousMember = await anonymousContext.request.get(`/api/users/${memberOne.userId}/profile`);
    expect(anonymousProfile.status()).toBe(401);
    expect(anonymousDirectory.status()).toBe(401);
    expect(anonymousMember.status()).toBe(401);
    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto('/ho-so');
    await expect(anonymousPage).toHaveURL(/\/dang-nhap\?returnTo=/u);
  } finally {
    await anonymousContext.close();
  }

  const ownResponse = await ownerRemote.api.get('/api/users/me/profile');
  const publicResponse = await memberOne.api.get(`/api/users/${owner.userId}/profile`);
  expect(ownResponse.headers()['cache-control']).toContain('no-store');
  expect(publicResponse.headers()['cache-control']).toContain('no-store');
  const ownBody = await ownResponse.json();
  const publicBody = await publicResponse.json();
  expect(Object.keys(ownBody.profile).sort()).toEqual([
    'bio', 'createdAt', 'displayName', 'id', 'location', 'updatedAt', 'version',
  ]);
  expect(Object.keys(publicBody.profile).sort()).toEqual(['bio', 'displayName', 'id', 'location']);
  expect(JSON.stringify(publicBody)).not.toMatch(/email|password|session|event|search|role|neo4j|profileVersion/iu);

  const csrfResponse = await page.request.get('/api/auth/csrf');
  const csrfToken = (await csrfResponse.json()).csrfToken as string;
  const forbiddenBase = { displayName: 'Should not persist', expectedVersion: 2 };
  const noCsrf = await page.request.patch('/api/users/me/profile', {
    headers: { Origin: webOrigin }, data: forbiddenBase,
  });
  const wrongOrigin = await page.request.patch('/api/users/me/profile', {
    headers: { Origin: 'https://not-weylume.invalid', 'X-CSRF-Token': csrfToken }, data: forbiddenBase,
  });
  const missingOrigin = await page.request.patch('/api/users/me/profile', {
    headers: { 'X-CSRF-Token': csrfToken }, data: forbiddenBase,
  });
  expect(noCsrf.status()).toBe(403);
  expect(wrongOrigin.status()).toBe(403);
  expect(missingOrigin.status()).toBe(403);

  const beforeAbuse = await readOwnerState(owner.userId);
  const injected = await memberOne.api.patch('/api/users/me/profile', {
    headers: { Origin: webOrigin, 'X-CSRF-Token': memberOne.csrfToken },
    data: {
      displayName: 'Injected identity', id: owner.userId, email: 'private-injection@example.invalid',
      passwordHash: 'not-a-real-hash', roles: ['admin'], profileVersion: 999,
      displayNameSearch: 'injected', profileCreatedAt: '2000-01-01', expectedVersion: 1,
    },
  });
  expect(injected.status()).toBe(422);
  expect(await injected.text()).not.toMatch(/private-injection|not-a-real-hash|Injected identity/iu);
  const arbitraryTarget = await memberOne.api.patch(`/api/users/${owner.userId}/profile`, {
    headers: { Origin: webOrigin, 'X-CSRF-Token': memberOne.csrfToken },
    data: { displayName: 'Should not work', expectedVersion: 2 },
  });
  expect(arbitraryTarget.status()).toBe(404);
  expect(await readOwnerState(owner.userId)).toEqual(beforeAbuse);

  const defaultPage = await ownerRemote.api.get('/api/users');
  const maxPage = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(marker)}&limit=50`);
  expect(defaultPage.status()).toBe(200);
  expect(maxPage.status()).toBe(200);
  const defaultBody = await defaultPage.json();
  const maxBody = await maxPage.json();
  expect(defaultBody.pagination.limit).toBe(20);
  expect(defaultBody.items.some((item: { id: string }) => item.id === owner.userId)).toBe(false);
  expect(maxBody.pagination.limit).toBe(50);
  expect(maxBody.items.map((item: { id: string }) => item.id).sort()).toEqual([memberOne.userId, memberTwo.userId].sort());
  for (const item of maxBody.items) expect(Object.keys(item).sort()).toEqual(['bio', 'displayName', 'id', 'location']);

  const accented = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(`NGUYỄN ${marker}`)}`);
  const unaccented = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(`nguyen ${marker}`)}`);
  const mappedD = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(`DANG ${marker}`)}`);
  expect((await accented.json()).items.map((item: { id: string }) => item.id)).toEqual([memberOne.userId]);
  expect((await unaccented.json()).items.map((item: { id: string }) => item.id)).toEqual([memberOne.userId]);
  expect((await mappedD.json()).items.map((item: { id: string }) => item.id)).toEqual([memberTwo.userId]);
  for (const privateQuery of [emailOnly, bioOnly, locationOnly]) {
    const response = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(privateQuery)}`);
    expect(response.status()).toBe(200);
    expect((await response.json()).items).toEqual([]);
  }

  const firstPageResponse = await ownerRemote.api.get(`/api/users?q=${encodeURIComponent(marker)}&limit=1`);
  const firstPageBody = await firstPageResponse.json();
  expect(firstPageBody.items).toHaveLength(1);
  expect(firstPageBody.pagination.hasMore).toBe(true);
  expect(typeof firstPageBody.pagination.nextCursor).toBe('string');
  const secondPageResponse = await ownerRemote.api.get(
    `/api/users?q=${encodeURIComponent(marker)}&limit=1&cursor=${encodeURIComponent(firstPageBody.pagination.nextCursor)}`,
  );
  const secondPageBody = await secondPageResponse.json();
  expect(secondPageBody.items).toHaveLength(1);
  expect(secondPageBody.pagination.hasMore).toBe(false);
  expect(secondPageBody.pagination.nextCursor).toBeNull();
  expect(new Set([firstPageBody.items[0].id, secondPageBody.items[0].id]).size).toBe(2);
  const invalidCursor = await ownerRemote.api.get('/api/users?cursor=not-a-cursor');
  const mismatchedCursor = await ownerRemote.api.get(
    `/api/users?q=other-query&limit=1&cursor=${encodeURIComponent(firstPageBody.pagination.nextCursor)}`,
  );
  expect(invalidCursor.status()).toBe(422);
  expect(mismatchedCursor.status()).toBe(422);

  await page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Khám phá' }).click();
  await expect(page.getByRole('heading', { name: 'Khám phá thành viên' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' });
  await search.fill(marker);
  await page.route('**/api/users?*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/users' && url.searchParams.has('q')) {
      url.searchParams.set('limit', '1');
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  const orderedIds = [memberOne.userId, memberTwo.userId].sort();
  const firstMember = orderedIds[0] === memberOne.userId ? memberOne : memberTwo;
  const secondMember = orderedIds[1] === memberOne.userId ? memberOne : memberTwo;
  await expect(page.getByRole('link', { name: firstMember.displayName })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/kham-pha\\?q=${marker}`, 'u'));
  await page.getByRole('button', { name: /Trang tiếp/ }).click();
  await expect(page.getByRole('link', { name: secondMember.displayName })).toBeVisible();
  await expect(page.getByRole('button', { name: /Trang tiếp/ })).toBeDisabled();
  await page.getByRole('button', { name: /Trang trước/ }).click();
  await expect(page.getByRole('link', { name: firstMember.displayName })).toBeVisible();
  await page.getByRole('link', { name: firstMember.displayName }).click();
  await expect(page).toHaveURL(new RegExp(`/thanh-vien/${firstMember.userId}$`, 'u'));
  await expect(page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Quay lại khám phá/ })).toHaveAttribute('href', `/kham-pha?q=${marker}`);
  await page.getByRole('link', { name: /Quay lại khám phá/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kham-pha\\?q=${marker}$`, 'u'));
  await page.unroute('**/api/users?*');

  const mappedDQuery = `DANG ${marker}`;
  const mappedDResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/users' &&
      url.searchParams.get('q') === mappedDQuery;
  });
  await search.fill(mappedDQuery);
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  expect((await mappedDResponse).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(mappedDQuery);
  await expect(page.getByRole('link', { name: memberTwo.displayName })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Đã đến cuối danh sách.');
  const noMatchQuery = `nomatch${randomUUID().slice(0, 8)}`;
  const noMatchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/users' &&
      url.searchParams.get('q') === noMatchQuery;
  });
  await search.fill(noMatchQuery);
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  const noMatch = await noMatchResponse;
  expect(noMatch.status()).toBe(200);
  expect((await noMatch.json()).items).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy thành viên phù hợp.' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Hồ sơ của tôi' }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Tên hiển thị').fill('Bản nháp cần được giữ');
  const remoteVersion = (await (await ownerRemote.api.get('/api/users/me/profile')).json()).profile.version;
  const conflictWrite = await ownerRemote.api.patch('/api/users/me/profile', {
    headers: { Origin: webOrigin, 'X-CSRF-Token': ownerRemote.csrfToken },
    data: { bio: 'Một phiên khác đã lưu trước.', expectedVersion: remoteVersion },
  });
  expect(conflictWrite.status()).toBe(200);
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('alert')).toContainText('Bản nháp của bạn vẫn được giữ lại.');
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Bản nháp cần được giữ');
  await page.getByRole('button', { name: 'Tải phiên bản mới' }).click();
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Bản nháp cần được giữ');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');
  expect((await readOwnerState(owner.userId)).version).toBe(remoteVersion + 2);

  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Địa điểm').fill('Lưu lại sau khi dịch vụ phục hồi');
  let failedSaveObserved = false;
  await page.route('**/api/users/me/profile', async (route) => {
    if (route.request().method() === 'PATCH' && !failedSaveObserved) {
      failedSaveObserved = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}' });
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Địa điểm')).toHaveValue('Lưu lại sau khi dịch vụ phục hồi');
  await page.unroute('**/api/users/me/profile');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');

  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Giới thiệu').fill('Chỉ một yêu cầu lưu đang chờ.');
  let pendingPatchCount = 0;
  let releasePendingPatch!: () => void;
  let reportPendingPatch!: () => void;
  const pendingGate = new Promise<void>((resolveGate) => { releasePendingPatch = resolveGate; });
  const pendingStarted = new Promise<void>((resolveGate) => { reportPendingPatch = resolveGate; });
  let released = false;
  const releaseGate = () => {
    if (released) return;
    released = true;
    releasePendingPatch();
  };
  await page.route('**/api/users/me/profile', async (route) => {
    if (route.request().method() === 'PATCH') {
      pendingPatchCount += 1;
      reportPendingPatch();
      await pendingGate;
    }
    await route.continue();
  });
  const pendingSave = page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  try {
    await pendingStarted;
    await expect(page.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
    await page.getByLabel('Tên hiển thị').press('Enter');
    const duplicateObserved = await page.waitForRequest(
      (request) => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me/profile',
      { timeout: 500 },
    ).then(() => true, (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    });
    expect(duplicateObserved).toBe(false);
  } finally {
    releaseGate();
    await pendingSave;
    await page.unroute('**/api/users/me/profile');
  }
  expect(pendingPatchCount).toBe(1);
  await expect(page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');

  await page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Khám phá' }).click();
  let releaseStaleResponse!: () => void;
  let reportStaleRequest!: () => void;
  const staleGate = new Promise<void>((resolveGate) => { releaseStaleResponse = resolveGate; });
  const staleStarted = new Promise<void>((resolveGate) => { reportStaleRequest = resolveGate; });
  const staleName = `OLD RESPONSE ${marker}`;
  await page.route('**/api/users?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === `stale${marker}`) {
      reportStaleRequest();
      await staleGate;
      try {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            items: [{ id: memberOne.userId, displayName: staleName, bio: null, location: null }],
            pagination: { limit: 20, hasMore: false, nextCursor: null },
          }),
        });
      } catch {
        // The browser may already have cancelled this deliberately delayed response.
      }
      return;
    }
    await route.continue();
  });
  await page.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' }).fill(`stale${marker}`);
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  await staleStarted;
  await page.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' }).fill(marker);
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  await expect(page.getByRole('link', { name: firstMember.displayName })).toBeVisible();
  releaseStaleResponse();
  await expect(page.getByRole('link', { name: staleName })).toHaveCount(0);
  await page.unroute('**/api/users?*');

  let profileLoadFailures = 0;
  await page.route('**/api/users/me/profile', async (route) => {
    if (route.request().method() === 'GET') {
      profileLoadFailures += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}' });
      return;
    }
    await route.continue();
  });
  await page.goto('/ho-so');
  await expect(page.getByRole('heading', { name: 'Chưa thể tải hồ sơ' })).toBeVisible();
  expect(profileLoadFailures).toBeGreaterThan(0);
  await page.unroute('**/api/users/me/profile');
  await page.getByRole('button', { name: 'Thử tải lại' }).click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();

  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE"}}' }));
  await page.goto('/ho-so');
  await expect(page.getByRole('heading', { name: 'Chưa thể xác minh phiên' })).toBeVisible();
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Thử kết nối lại' }).click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();

  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
  await page.getByLabel('Tên hiển thị').fill('😀');
  let invalidMutationCount = 0;
  const countInvalidPatch = (request: { method(): string; url(): string }) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me/profile') invalidMutationCount += 1;
  };
  page.on('request', countInvalidPatch);
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  page.off('request', countInvalidPatch);
  expect(invalidMutationCount).toBe(0);
  await page.getByRole('button', { name: 'Hủy' }).click();

  await page.goto('/thanh-vien/' + memberTwo.userId);
  await expect(page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
  await expect(page.getByText(memberTwo.displayName)).toBeVisible();
  await expect(page.getByText(/Mình yêu văn hóa Việt Nam/)).toBeVisible();
  const widths = [[1440, 900], [768, 1024], [390, 844], [320, 740]] as const;
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height });
    for (const path of ['/ho-so', '/kham-pha', `/thanh-vien/${memberTwo.userId}`]) {
      await page.goto(path);
      if (path.startsWith('/ho-so')) await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
      if (path === '/kham-pha') await expect(page.getByRole('heading', { name: 'Khám phá thành viên' })).toBeVisible();
      if (path.startsWith('/thanh-vien')) await expect(page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      expect(dimensions.document, `${path} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ho-so');
  await page.locator('.member-header a').first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Đi đến nội dung chính' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#member-content')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

  const finalAuthState = await readAuthState(owner.userId);
  expect(finalAuthState).toEqual(beforeReads.auth);
  await ownerRemote.api.dispose();
  await memberOne.api.dispose();
  await memberTwo.api.dispose();

  console.log(JSON.stringify({
    scenarios: ['UPD-01', 'UPD-02', 'UPD-03', 'UPD-04', 'UPD-05', 'UPD-06', 'UPD-07', 'UPD-08'],
    realStack: true,
    syntheticAccounts: 3,
    registrationDefaultsAndGetNonMutation: 'PASS',
    profilePersistenceAndConflictRecovery: 'PASS',
    searchAndPagination: 'PASS',
    controlledFailuresWereSimulated: true,
    viewports: widths,
    passwordsOrTokensLogged: false,
  }));
});

async function registerThroughUI(page: Page): Promise<Account> {
  const email = `profile-${randomUUID()}@example.invalid`;
  const password = `Weylume-${randomUUID()}!`;
  await assertEmailAbsent(email);
  const manifest = await recordFixtureOwnership(email);
  const record = { manifest };
  ownedAccounts.set(email, record);
  await page.goto('/dang-ky');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill(password);
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/register');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = await response.json();
  const userId = body.user.id as string;
  expect(userId).toMatch(/^[0-9a-f-]{36}$/iu);
  record.userId = userId;
  await updateFixtureOwnership(manifest, email, userId);
  await expect(page.getByRole('status')).toContainText('Tạo tài khoản thành công');
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  return { email, password, userId, csrfToken: '', api: page.request };
}

async function registerThroughApi(input: {
  displayName: string; bio: string; location: string; emailPrefix?: string;
}): Promise<Account & { displayName: string }> {
  const email = `${input.emailPrefix ?? `profile-${randomUUID()}`}@example.invalid`;
  const password = `Weylume-${randomUUID()}!`;
  await assertEmailAbsent(email);
  const manifest = await recordFixtureOwnership(email);
  const record: { userId?: string; manifest: string } = { manifest };
  ownedAccounts.set(email, record);
  const api = await playwrightRequest.newContext({ baseURL: webOrigin });
  const csrfBootstrap = await api.get('/api/auth/csrf');
  expect(csrfBootstrap.status()).toBe(200);
  const registration = await api.post('/api/auth/register', {
    headers: { Origin: webOrigin, 'X-CSRF-Token': (await csrfBootstrap.json()).csrfToken },
    data: { email, password },
  });
  expect(registration.status()).toBe(201);
  const userId = (await registration.json()).user.id as string;
  record.userId = userId;
  await updateFixtureOwnership(manifest, email, userId);
  const csrfToken = await loginWithAgent(api, email, password);
  const update = await api.patch('/api/users/me/profile', {
    headers: { Origin: webOrigin, 'X-CSRF-Token': csrfToken },
    data: { displayName: input.displayName, bio: input.bio, location: input.location, expectedVersion: 0 },
  });
  expect(update.status()).toBe(200);
  return { email, password, userId, csrfToken, api, displayName: input.displayName };
}

async function loginViaApi(email: string, password: string): Promise<Pick<Account, 'api' | 'csrfToken'>> {
  const api = await playwrightRequest.newContext({ baseURL: webOrigin });
  const csrfResponse = await api.get('/api/auth/csrf');
  const csrfToken = await loginWithAgent(api, email, password, (await csrfResponse.json()).csrfToken);
  return { api, csrfToken };
}

async function loginWithAgent(api: APIRequestContext, email: string, password: string, initialToken?: string): Promise<string> {
  const token = initialToken ?? (await (await api.get('/api/auth/csrf')).json()).csrfToken;
  const login = await api.post('/api/auth/login', {
    headers: { Origin: webOrigin, 'X-CSRF-Token': token },
    data: { email, password },
  });
  expect(login.status()).toBe(200);
  return (await login.json()).csrfToken as string;
}

async function assertEmailAbsent(email: string): Promise<void> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run('MATCH (user:User {email: $email}) RETURN count(user) AS count', { email });
    expect(asNumber(result.records[0]?.get('count'))).toBe(0);
  } finally {
    await session.close();
  }
}

async function recordFixtureOwnership(email: string): Promise<string> {
  await mkdir(recoveryDirectory, { recursive: true });
  const manifest = resolve(recoveryDirectory, `profile-account-${process.pid}-${randomUUID()}.json`);
  await writeFile(manifest, JSON.stringify({ version: 1, pid: process.pid, email }), { flag: 'wx' });
  return manifest;
}

async function updateFixtureOwnership(manifest: string, email: string, userId: string): Promise<void> {
  await writeFile(manifest, JSON.stringify({ version: 1, pid: process.pid, email, userId } satisfies FixtureManifest));
}

async function recoverInterruptedFixtures(): Promise<void> {
  await mkdir(recoveryDirectory, { recursive: true });
  const session = driver.session({ database: 'isn-test' });
  try {
    for (const name of await readdir(recoveryDirectory)) {
      if (!/^profile-account-\d+-[0-9a-f-]{36}\.json$/u.test(name)) continue;
      const manifest = resolve(recoveryDirectory, name);
      const ownership = JSON.parse(await readFile(manifest, 'utf8')) as Partial<FixtureManifest>;
      if (ownership.version !== 1 || !Number.isSafeInteger(ownership.pid) || typeof ownership.email !== 'string' ||
          !/^profile-[0-9a-f-]{36}@example\.invalid$/u.test(ownership.email) ||
          (ownership.userId !== undefined && !/^[0-9a-f-]{36}$/iu.test(ownership.userId))) {
        throw new Error('Profile fixture ownership manifest is invalid; stopping before fixture cleanup.');
      }
      if (ownership.pid === process.pid || processIsAlive(ownership.pid!)) continue;
      const removed = await cleanupOwnedAccount(session, ownership.email, ownership.userId);
      if (removed.users === 1 && !ownership.userId) {
        throw new Error('Interrupted fixture lacks its created User UUID; account was preserved for manual ownership review.');
      }
      await rm(manifest);
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

async function cleanupOwnedAccount(session: Session, email: string, expectedId?: string): Promise<Counts> {
  const ownerResult = await session.run(
    'MATCH (user:User {email: $email}) RETURN user.id AS id', { email },
  );
  if (ownerResult.records.length === 0) return { users: 0, sessions: 0, events: 0 };
  if (ownerResult.records.length !== 1 || !expectedId) {
    throw new Error('Profile fixture ownership cannot be positively verified; no records were deleted.');
  }
  const userId = ownerResult.records[0].get('id');
  if (userId !== expectedId) throw new Error('Profile fixture UUID does not match its ownership record; no records were deleted.');

  const relations = await session.run(
    `MATCH (user:User {id: $userId, email: $email}) OPTIONAL MATCH (user)-[relationship]-()
     RETURN collect(DISTINCT type(relationship)) AS types`, { userId, email },
  );
  const relationTypes = (relations.records[0]?.get('types') as Array<string | null> ?? []).filter(Boolean);
  if (relationTypes.some((type) => type !== 'HAS_AUTH_SESSION' && type !== 'PERFORMED_AUTH_EVENT')) {
    throw new Error('Fixture has an unexpected relationship; no records were deleted.');
  }

  const linked = await session.run(
    `MATCH (user:User {id: $userId, email: $email})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
     WITH user, collect(DISTINCT authSession) AS sessions
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN [item IN sessions WHERE item IS NOT NULL | item.id] AS sessionIds,
            collect(DISTINCT event.eventId) AS eventIds`, { userId, email },
  );
  const sessionIds = linked.records[0]?.get('sessionIds') as string[] ?? [];
  const eventIds = (linked.records[0]?.get('eventIds') as Array<string | null> ?? []).filter((id): id is string => Boolean(id));
  const sharedSessions = await session.run(
    `MATCH (other:User)-[:HAS_AUTH_SESSION]->(item:AuthSession)
     WHERE item.id IN $ids AND other.id <> $userId RETURN count(item) AS count`, { ids: sessionIds, userId },
  );
  const sharedEvents = await session.run(
    `MATCH (other:User)-[:PERFORMED_AUTH_EVENT]->(item:AuthActivityEvent)
     WHERE item.eventId IN $ids AND other.id <> $userId RETURN count(item) AS count`, { ids: eventIds, userId },
  );
  if (asNumber(sharedSessions.records[0]?.get('count')) !== 0 || asNumber(sharedEvents.records[0]?.get('count')) !== 0) {
    throw new Error('Fixture auth records are linked to another user; no records were deleted.');
  }

  await session.executeWrite((transaction) => transaction.run(
    `MATCH (user:User {id: $userId, email: $email})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     WITH user, collect(DISTINCT authSession) AS sessions, collect(DISTINCT event) AS events
     UNWIND [user] + [item IN sessions WHERE item IS NOT NULL] + [item IN events WHERE item IS NOT NULL] AS owned
     DETACH DELETE owned`, { userId, email },
  ));

  const remainingUser = await session.run(
    'MATCH (user:User {id: $userId, email: $email}) RETURN count(user) AS count', { userId, email },
  );
  const remainingSessions = await session.run(
    'MATCH (item:AuthSession) WHERE item.id IN $ids RETURN count(item) AS count', { ids: sessionIds },
  );
  const remainingEvents = await session.run(
    'MATCH (item:AuthActivityEvent) WHERE item.eventId IN $ids RETURN count(item) AS count', { ids: eventIds },
  );
  assert.equal(asNumber(remainingUser.records[0]?.get('count')), 0);
  assert.equal(asNumber(remainingSessions.records[0]?.get('count')), 0);
  assert.equal(asNumber(remainingEvents.records[0]?.get('count')), 0);
  return { users: 1, sessions: sessionIds.length, events: eventIds.length };
}

async function readCounts(session: Session): Promise<Counts> {
  try {
    const result = await session.run(
      `CALL { MATCH (user:User) RETURN count(user) AS users }
       CALL { MATCH (authSession:AuthSession) RETURN count(authSession) AS sessions }
       CALL { MATCH (event:AuthActivityEvent) RETURN count(event) AS events }
       RETURN users, sessions, events`,
    );
    const record = result.records[0];
    assert.ok(record);
    return {
      users: asNumber(record.get('users')),
      sessions: asNumber(record.get('sessions')),
      events: asNumber(record.get('events')),
    };
  } finally {
    await session.close();
  }
}

async function readCurrentCounts(): Promise<Counts> {
  const session = driver.session({ database: 'isn-test' });
  return readCounts(session);
}

async function readOwnerState(userId: string): Promise<Record<string, unknown>> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const profile = await session.run(
      `MATCH (user:User {id: $userId})
       RETURN user.id AS id, user.email AS email, user.passwordHash AS passwordHash,
              toString(user.createdAt) AS accountCreatedAt,
              user.displayName AS displayName, user.bio AS bio, user.location AS location,
              user.bio IS NULL AS bioPropertyAbsent, user.location IS NULL AS locationPropertyAbsent,
              toString(user.profileCreatedAt) AS profileCreatedAt,
              toString(user.profileUpdatedAt) AS profileUpdatedAt,
              user.profileVersion AS version, user.displayNameSearch AS displayNameSearch`, { userId },
    );
    const record = profile.records[0];
    assert.ok(record);
    return {
      id: record.get('id'), email: record.get('email'), passwordHash: record.get('passwordHash'),
      accountCreatedAt: record.get('accountCreatedAt'), displayName: record.get('displayName'),
      bio: record.get('bio'), location: record.get('location'),
      bioPropertyAbsent: record.get('bioPropertyAbsent'), locationPropertyAbsent: record.get('locationPropertyAbsent'),
      profileCreatedAt: record.get('profileCreatedAt'), profileUpdatedAt: record.get('profileUpdatedAt'),
      version: asNumber(record.get('version')), displayNameSearch: record.get('displayNameSearch'),
      auth: await readAuthStateInSession(session, userId),
    };
  } finally {
    await session.close();
  }
}

async function readAuthState(userId: string): Promise<Record<string, unknown>> {
  const session = driver.session({ database: 'isn-test' });
  try {
    return await readAuthStateInSession(session, userId);
  } finally {
    await session.close();
  }
}

async function readAuthStateInSession(session: Session, userId: string): Promise<Record<string, unknown>> {
  const result = await session.run(
    `MATCH (user:User {id: $userId})
     OPTIONAL MATCH (user)-[:HAS_AUTH_SESSION]->(authSession:AuthSession)
     WITH user, collect(DISTINCT authSession.jti) AS sessions
     OPTIONAL MATCH (user)-[:PERFORMED_AUTH_EVENT]->(event:AuthActivityEvent)
     RETURN user.id AS id, user.email AS email, user.passwordHash AS passwordHash,
            toString(user.createdAt) AS createdAt, sessions,
            collect(DISTINCT event.eventId) AS eventIds,
            collect(DISTINCT event.eventType) AS eventTypes`, { userId },
  );
  const record = result.records[0];
  assert.ok(record);
  return {
    id: record.get('id'), email: record.get('email'), passwordHash: record.get('passwordHash'),
    createdAt: record.get('createdAt'), sessions: [...(record.get('sessions') as string[])].sort(),
    eventIds: [...(record.get('eventIds') as string[])].sort(),
    eventTypes: [...(record.get('eventTypes') as string[])].sort(),
  };
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number.NaN;
}
