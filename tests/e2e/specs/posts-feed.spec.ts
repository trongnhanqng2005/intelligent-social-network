import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import type { PostsScenario } from '../../fixtures/posts/scenario-support.mjs';

const apiOrigin = 'http://127.0.0.1:3312';
const webOrigin = 'http://127.0.0.1:5182';
const requestTimeout = 15_000;

type Scenario = PostsScenario;
type Actor = Scenario['users'][number] & { context: BrowserContext; page: Page; csrfToken: string };
type ControlledFeedDelivery = {
  arrival: Promise<void>;
  settled: Promise<void>;
  gate: Promise<void>;
  arrive(): void;
  settle(): void;
  release(): void;
  started: boolean;
  hasPost: boolean;
  hasDeletedPost: boolean;
  delivered: boolean;
};
type ScenarioSupport = {
  cleanupPostsScenario(scenario: Scenario): Promise<void>;
  createPostsScenario(options?: { actorCount?: number }): Promise<Scenario>;
  recordScenarioAuthState(scenario: Scenario, userId: string): Promise<boolean | void>;
  recordScenarioContext(scenario: Scenario, context: BrowserContext): Promise<void>;
  recordScenarioFriendshipCreated(scenario: Scenario, intentId: string, requestId: string, requestedAt?: string): Promise<void>;
  recordScenarioFriendshipResolved(scenario: Scenario, intentId: string, result: Record<string, unknown>): Promise<void>;
  recordScenarioPost(scenario: Scenario, input: { authorId: string; marker: string; postId: string }): Promise<void>;
  reserveScenarioFriendship(scenario: Scenario, input: { senderId: string; recipientId: string }): Promise<string>;
  reserveScenarioPost(scenario: Scenario, input: { authorId: string; marker: string; visibility: 'friends' | 'members' }): Promise<void>;
};

let scenarioSupportPromise: Promise<ScenarioSupport> | undefined;

function scenarioSupport() {
  scenarioSupportPromise ??= import('../../fixtures/posts/scenario-support.mjs') as Promise<ScenarioSupport>;
  return scenarioSupportPromise;
}

async function createPostsScenario(options?: { actorCount?: number }) {
  return (await scenarioSupport()).createPostsScenario(options);
}

async function cleanupPostsScenario(scenario: Scenario) {
  return (await scenarioSupport()).cleanupPostsScenario(scenario);
}

async function recordScenarioAuthState(scenario: Scenario, userId: string) {
  return (await scenarioSupport()).recordScenarioAuthState(scenario, userId);
}

async function recordScenarioContext(scenario: Scenario, context: BrowserContext) {
  return (await scenarioSupport()).recordScenarioContext(scenario, context);
}

async function recordScenarioFriendshipCreated(scenario: Scenario, intentId: string, requestId: string, requestedAt?: string) {
  return (await scenarioSupport()).recordScenarioFriendshipCreated(scenario, intentId, requestId, requestedAt);
}

async function recordScenarioFriendshipResolved(scenario: Scenario, intentId: string, result: Record<string, unknown>) {
  return (await scenarioSupport()).recordScenarioFriendshipResolved(scenario, intentId, result);
}

async function recordScenarioPost(scenario: Scenario, input: { authorId: string; marker: string; postId: string }) {
  return (await scenarioSupport()).recordScenarioPost(scenario, input);
}

async function reserveScenarioFriendship(scenario: Scenario, input: { senderId: string; recipientId: string }) {
  return (await scenarioSupport()).reserveScenarioFriendship(scenario, input);
}

async function reserveScenarioPost(scenario: Scenario, input: { authorId: string; marker: string; visibility: 'friends' | 'members' }) {
  return (await scenarioSupport()).reserveScenarioPost(scenario, input);
}

test.describe.configure({ mode: 'default' });

test('PF-00 V5 gate and real runtime readiness @lifecycle-security', async () => {
  const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(requestTimeout) });
  const readiness = await fetch(`${apiOrigin}/ready`, { signal: AbortSignal.timeout(requestTimeout) });
  expect(health.status).toBe(200);
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toEqual({ status: 'ready', database: 'isn-test', schemaVersion: 5 });
});

test('PF-01–PF-08 real authentication, security boundaries and Post lifecycle @lifecycle-security', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author, member, stranger] = await loginActors(scenario, browser, scenario.users);
    expect(author && member && stranger).toBeTruthy();

      await test.step('PF-01 unauthenticated Feed/detail/API access and successful UI login', async () => {
        const anonymous = await browser.newContext({ baseURL: webOrigin });
        try {
          const page = await anonymous.newPage();
          await page.goto('/bang-tin');
          await expect(page).toHaveURL(/\/dang-nhap/u);
          await expect(page.getByRole('heading', { name: 'Bảng tin' })).toHaveCount(0);
          const protectedList = await anonymous.request.get(`${webOrigin}/api/feed`);
          expect(protectedList.status()).toBe(401);
          const anonymousPostId = randomUUID();
          const detail = await anonymous.newPage();
          await detail.goto(`/bai-viet/${anonymousPostId}`);
          await expect(detail).toHaveURL(new RegExp(`returnTo=${encodeURIComponent(`/bai-viet/${anonymousPostId}`)}`, 'u'));
          await expect(detail.getByLabel('Địa chỉ email')).toBeVisible();
          await expect(detail.getByRole('heading', { name: 'Bài viết' })).toHaveCount(0);
          const missing = await anonymous.request.get(`${webOrigin}/api/posts/${anonymousPostId}`);
          expect(missing.status()).toBe(401);
          await author.page.goto('/bang-tin');
        await expect(author.page.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
        await author.page.reload();
        await expect(author.page.getByRole('heading', { name: 'Bảng tin' })).toBeVisible();
      } finally {
        await anonymous.close();
      }
    });

    let ownerPost: Record<string, any>;
    let memberPost: Record<string, any>;
    await test.step('PF-02 CSRF/Origin rejection, trusted Referer fallback and no mutation on rejection', async () => {
      const marker = markerFor('referer');
      const content = `Kiểm thử ${marker}`;
      const before = await countPosts(scenario, author.id);
      const csrf = author.csrfToken;
      const rejected = [
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { Origin: webOrigin }, data: { content },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { Origin: webOrigin, 'X-CSRF-Token': 'invalid' }, data: { content },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { Origin: 'https://foreign.invalid', 'X-CSRF-Token': csrf }, data: { content },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { Origin: webOrigin, 'X-CSRF-Token': csrf, 'Sec-Fetch-Site': 'cross-site' }, data: { content },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { 'X-CSRF-Token': csrf }, data: { content },
        }),
      ];
      for (const response of rejected) {
        expect(response.status()).toBe(403);
        expect(response.headers()['cache-control']).toContain('no-store');
      }
      expect(await countPosts(scenario, author.id)).toBe(before);

      const refererMarker = markerFor('trusted-referer');
      await reserveScenarioPost(scenario, { authorId: author.id, marker: refererMarker, visibility: 'friends' });
      const accepted = await author.context.request.post(`${webOrigin}/api/posts`, {
        headers: {
          Referer: `${webOrigin}/bang-tin`,
          'X-CSRF-Token': csrf,
        },
        data: { content: `Tham chiếu tin cậy ${refererMarker}` },
      });
      expect(accepted.status()).toBe(201);
      const body = await accepted.json();
      await recordScenarioPost(scenario, { authorId: author.id, marker: refererMarker, postId: body.post.id });
    });

    await test.step('PF-03 strict DTOs, content limits, parser limits and privacy-safe errors', async () => {
      const authHeaders = { Origin: webOrigin, 'X-CSRF-Token': author.csrfToken };
      const postsBefore = await countPosts(scenario, author.id);
        const invalidRequests = [
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: authHeaders, data: { content: 'field spoof', authorId: stranger.id },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: authHeaders, data: { content: 'bad visibility', visibility: 'public' },
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { ...authHeaders, 'Content-Type': 'application/json' }, data: '{"content":',
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          data: JSON.stringify({ content: 'x'.repeat(40 * 1024) }),
        }),
        await author.context.request.post(`${webOrigin}/api/auth/register`, {
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          data: JSON.stringify({ payload: 'x'.repeat(9 * 1024) }),
        }),
        await author.context.request.post(`${webOrigin}/api/posts`, {
          headers: { ...authHeaders, 'Content-Type': 'text/plain' }, data: 'plain body',
        }),
        await apiCall(author, 'DELETE', `/posts/${randomUUID()}?expectedVersion=0`, {}),
      ];
      const invalidExpectedVersion = await apiCall(author, 'DELETE', `/posts/${randomUUID()}?expectedVersion=not-a-number`);
      expect(invalidRequests.map((response) => response.status())).toEqual([422, 422, 400, 413, 413, 415, 422]);
      expect(invalidExpectedVersion.status()).toBe(422);
      const invalidId = await apiCall(author, 'GET', '/posts/not-a-uuid');
      expect(invalidId.status()).toBe(422);
      const invalidCursor = await apiCall(author, 'GET', '/feed?limit=2&cursor=bad');
      expect(invalidCursor.status()).toBe(422);
      const invalidQuery = await apiCall(author, 'GET', '/feed?limit=2&limit=3');
      expect(invalidQuery.status()).toBe(422);
      for (const response of [...invalidRequests, invalidExpectedVersion, invalidId, invalidCursor, invalidQuery]) {
        expect(response.headers()['cache-control']).toContain('no-store');
        const body = await response.text();
        expect(body).not.toMatch(/passwordHash|sessionToken|csrfToken|stack trace|neo4j:\/\//iu);
      }
      expect(await countPosts(scenario, author.id)).toBe(postsBefore);
    });

    await test.step('PF-04 visible non-owner 403 versus invisible/missing privacy-safe 404', async () => {
      ownerPost = await createPostFromComposer(scenario, author, {
        content: `Chỉ dành cho bạn bè ${markerFor('friends-only')}`,
        visibility: 'friends',
      });
      memberPost = await createPostFromComposer(scenario, author, {
        content: `Dành cho thành viên ${markerFor('members-only')}`,
        visibility: 'members',
      });
      const hidden = await apiCall(stranger, 'GET', `/posts/${ownerPost.id}`);
      const visible = await apiCall(stranger, 'GET', `/posts/${memberPost.id}`);
      expect(hidden.status()).toBe(404);
      expect(visible.status()).toBe(200);
      const deniedEdit = await apiCall(stranger, 'PATCH', `/posts/${memberPost.id}`, {
        content: 'unauthorized change', expectedVersion: 0,
      });
      const deniedDelete = await apiCall(stranger, 'DELETE', `/posts/${memberPost.id}?expectedVersion=0`);
      expect(deniedEdit.status()).toBe(403);
      expect(deniedDelete.status()).toBe(403);
      expect(JSON.stringify(await hidden.json())).not.toMatch(/nội dung|friends-only|author|email/iu);
      await stranger.page.goto(`/thanh-vien/${author.id}`);
      await expect(stranger.page.locator('.post-card').filter({ hasText: ownerPost.content })).toHaveCount(0);
      const visibleCard = stranger.page.locator('.post-card').filter({ hasText: memberPost.content });
      await expect(visibleCard).toBeVisible();
      await expect(visibleCard.getByRole('button', { name: /Chỉnh sửa bài viết|Xóa bài viết/u })).toHaveCount(0);
      const randomMissing = await apiCall(stranger, 'GET', `/posts/${randomUUID()}`);
      expect(randomMissing.status()).toBe(hidden.status());
    });

    await test.step('PF-05 real text Post create/detail/profile/reload and exact authorship persistence', async () => {
      const text = `Xin chào Việt Nam 🌿\r\nDòng thứ hai cùng emoji 👩‍👩‍👧‍👦 — nội dung ${markerFor('lifecycle')}`;
      const post = await createPostFromComposer(scenario, author, { content: text });
      ownerPost = post;
      expect(post.visibility).toBe('friends');
      expect(post.content).toContain('\n');
      expect(post.content).not.toContain('\r');
      expect(post.author.id).toBe(author.id);
      expect(post.version).toBe(0);
      expect(Number.isFinite(Date.parse(post.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(post.updatedAt))).toBe(true);
      const read = await apiCall(author, 'GET', `/posts/${post.id}`);
      expect(read.status()).toBe(200);
      expect((await read.json()).post).toMatchObject({
        id: post.id, content: post.content, version: 0,
        createdAt: post.createdAt, updatedAt: post.updatedAt,
      });
      const persisted = await scenario.session.run(
        `MATCH (user:User {id:$authorId})-[edge:AUTHORED]->(post:Post {id:$postId})
         RETURN post.authorId AS authorId,post.content AS content,post.version AS version,
                toString(post.createdAt) AS createdAt,toString(post.updatedAt) AS updatedAt,
                count(edge) AS edges`,
        { authorId: author.id, postId: post.id },
      );
      expect(persisted.records).toHaveLength(1);
      expect(persisted.records[0]?.get('authorId')).toBe(author.id);
      expect(persisted.records[0]?.get('content')).toBe(post.content);
      expect(asNumber(persisted.records[0]?.get('version'))).toBe(0);
      expect(Date.parse(String(persisted.records[0]?.get('createdAt')))).toBe(Date.parse(post.createdAt));
      expect(Date.parse(String(persisted.records[0]?.get('updatedAt')))).toBe(Date.parse(post.updatedAt));
      expect(post.updatedAt).toBe(post.createdAt);
      expect(asNumber(persisted.records[0]?.get('edges'))).toBe(1);
      await author.page.goto('/ho-so');
      await expect(author.page.locator('.post-card').filter({ hasText: post.content })).toBeVisible();
      await author.page.reload();
      await expect(author.page.locator('.post-card').filter({ hasText: post.content })).toBeVisible();
    });

    await test.step('PF-06 members visibility and expectedVersion edit preserve visibility/order', async () => {
      const before = memberPost;
      await author.page.goto('/bang-tin');
      const card = author.page.locator('.post-card').filter({ hasText: before.content });
      await card.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      const editor = card.getByLabel('Chỉnh sửa nội dung bài viết');
      const updatedContent = `${before.content} — đã cập nhật`;
      await editor.fill(updatedContent);
      const patchPromise = waitForResponse(author.page, 'PATCH', `/api/posts/${before.id}`);
      await card.getByRole('button', { name: 'Lưu thay đổi' }).click();
      const response = await patchPromise;
      expect(response.status()).toBe(200);
      const updated = (await response.json()).post;
      expect(updated.version).toBe(before.version + 1);
      expect(updated.visibility).toBe('members');
      expect(updated.createdAt).toBe(before.createdAt);
      expect(updated.content).toBe(updatedContent);
      await expect(card.getByText('Đã chỉnh sửa')).toBeVisible();
      const memberRead = await apiCall(stranger, 'GET', `/users/${author.id}/posts`);
      expect(memberRead.status()).toBe(200);
      expect((await memberRead.json()).items.some((item: { id: string }) => item.id === before.id)).toBe(true);
    });

    await test.step('PF-07 empty, Unicode and normalized 2,000-code-point boundaries', async () => {
      await author.page.goto('/bang-tin');
      const composer = author.page.getByLabel('Nội dung bài viết');
      let createRequests = 0;
      const countPosts = (request: { method(): string; url(): string }) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/posts') createRequests += 1;
      };
      author.page.on('request', countPosts);
      await author.page.getByRole('button', { name: 'Đăng bài' }).click();
      await expect(author.page.getByRole('alert')).toContainText('nội dung');
      await composer.fill('  \n  ');
      await author.page.getByRole('button', { name: 'Đăng bài' }).click();
      await expect(author.page.getByRole('alert')).toContainText('nội dung');
      await composer.fill('x'.repeat(2_001));
      await author.page.getByRole('button', { name: 'Đăng bài' }).click();
      await expect(author.page.getByRole('alert')).toContainText('2.000');
      expect(createRequests).toBe(0);
      author.page.off('request', countPosts);

      const malformed = await apiCall(author, 'POST', '/posts', { content: '\u202eunsafe' });
      const loneSurrogate = await apiCall(author, 'POST', '/posts', { content: '\ud800' });
      const controlCharacter = await apiCall(author, 'POST', '/posts', { content: `invalid\u0000${markerFor('control')}` });
      expect(malformed.status()).toBe(422);
      expect(loneSurrogate.status()).toBe(422);
      expect(controlCharacter.status()).toBe(422);
      const nfcMarker = markerFor('nfc-normalization');
      const normalized = await createPostFromComposer(scenario, author, {
        content: `Cafe\u0301 and Vietnamese ${nfcMarker}`, visibility: 'members',
      });
      expect(normalized.content).toBe(`Café and Vietnamese ${nfcMarker}`);
      const normalizedMarker = markerFor('unicode-boundary');
      const prefix = `${normalizedMarker} `;
      const boundary = `${prefix}${'á'.repeat(2_000 - Array.from(prefix).length)}`;
      expect(Array.from(boundary).length).toBe(2_000);
      const exact = await createPostFromComposer(scenario, author, { content: boundary, visibility: 'members' });
      expect(Array.from(exact.content).length).toBe(2_000);

      const plainText = `<script>not executable</script> ${markerFor('literal-html')}`;
      const literal = await createPostFromComposer(scenario, author, { content: plainText, visibility: 'members' });
      await expect(author.page.locator('.post-card-content').filter({ hasText: plainText })).toBeVisible();
      expect(await author.page.locator('.post-card-content script').count()).toBe(0);
      expect(literal.content).toBe(plainText);
    });

    await test.step('PF-08 explicit delete confirmation, focus restoration, permanent and stale delete', async () => {
      const deletion = ownerPost;
      await author.page.goto('/bang-tin');
      const card = author.page.locator('.post-card').filter({ hasText: deletion.content });
      const deleteButton = card.getByRole('button', { name: 'Xóa bài viết' });
      await deleteButton.click();
      const confirmation = card.getByRole('group', { name: 'Xác nhận xóa bài viết vĩnh viễn' });
      await expect(confirmation).toBeFocused();
      await card.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(deleteButton).toBeFocused();
      await deleteButton.click();
      const deletePromise = waitForResponse(author.page, 'DELETE', `/api/posts/${deletion.id}`);
      await card.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
      const deleted = await deletePromise;
      expect(deleted.status()).toBe(204);
      await expect(card).toHaveCount(0);
      await expect(author.page.getByRole('heading', { name: 'Mới nhất' })).toBeFocused();
      expect((await apiCall(author, 'GET', `/posts/${deletion.id}`)).status()).toBe(404);
      expect((await apiCall(author, 'DELETE', `/posts/${deletion.id}?expectedVersion=${deletion.version}`)).status()).toBe(404);
      const removed = await scenario.session.run('MATCH (post:Post {id:$id}) RETURN count(post) AS count', { id: deletion.id });
      expect(asNumber(removed.records[0]?.get('count'))).toBe(0);

      const stale = await createPostFromComposer(scenario, author, {
        content: `stale delete ${markerFor('stale-delete')}`, visibility: 'friends',
      });
      const staleCard = author.page.locator('.post-card').filter({ hasText: stale.content });
      await staleCard.getByRole('button', { name: 'Xóa bài viết' }).click();
      const externalEdit = await apiCall(author, 'PATCH', `/posts/${stale.id}`, {
        content: `${stale.content} revised`, expectedVersion: stale.version,
      });
      expect(externalEdit.status()).toBe(200);
      const staleDelete = waitForResponse(author.page, 'DELETE', `/api/posts/${stale.id}`);
      await staleCard.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
      const conflict = await staleDelete;
      expect(conflict.status()).toBe(409);
      const staleConfirmation = staleCard.getByRole('group', { name: 'Xác nhận xóa bài viết vĩnh viễn' });
      await expect(staleConfirmation.getByRole('status')).toContainText('tải lại');
      expect((await apiCall(author, 'GET', `/posts/${stale.id}`)).status()).toBe(200);
    });
  } finally {
    await cleanupPostsScenario(scenario);
  }
});

test('PF-09–PF-14 current friendship visibility, privacy-safe profile lists and real Feed pagination @visibility-feed', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 4 });
  try {
    const [author, friend, stranger, empty] = await loginActors(scenario, browser, scenario.users);
    const olderMembersOnly = await createPostFromComposer(scenario, author, {
      content: `Older member history ${markerFor('visibility-members-older')}`, visibility: 'members',
    });
    const friendsOnly = await createPostFromComposer(scenario, author, {
      content: `Historical friends ${markerFor('visibility-friends')}`, visibility: 'friends',
    });
    const membersOnly = await createPostFromComposer(scenario, author, {
      content: `Historical members ${markerFor('visibility-members')}`, visibility: 'members',
    });

    await test.step('PF-09 owner/default/friends/members visibility across stranger, pending and accepted states', async () => {
      expect(friendsOnly.visibility).toBe('friends');
      expect((await apiCall(author, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(200);
      expect((await apiCall(stranger, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(404);
      expect((await apiCall(stranger, 'GET', `/posts/${membersOnly.id}`)).status()).toBe(200);
      const intent = await requestFriendship(scenario, friend, author);
      expect((await apiCall(friend, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(404);
      await friend.page.goto(`/thanh-vien/${author.id}`);
      await expect(friend.page.locator('.post-card').filter({ hasText: friendsOnly.content })).toHaveCount(0);
      const pendingProfile = await apiCall(friend, 'GET', `/users/${author.id}/posts`);
      expect(pendingProfile.status()).toBe(200);
      const pendingItems = (await pendingProfile.json()).items;
      expect(pendingItems.some((item: { id: string }) => item.id === friendsOnly.id)).toBe(false);
      expect(pendingItems.some((item: { id: string }) => item.id === membersOnly.id)).toBe(true);
      const pendingProfileIds = await readMemberProfileIds(friend, author.id);
      expect(pendingProfileIds).toContain(membersOnly.id);
      expect(pendingProfileIds).toContain(olderMembersOnly.id);
      expect(pendingProfileIds).not.toContain(friendsOnly.id);
      const pendingPage = await apiCall(friend, 'GET', `/users/${author.id}/posts?limit=1`);
      const pendingPageBody = await pendingPage.json();
      const pendingCursor = pendingPageBody.pagination.nextCursor;
      const expectedPendingIds = await readVisibleMemberProfileOracle(scenario, friend.id, author.id);
      expect(pendingPageBody.items.map((item: { id: string }) => item.id)).toEqual(expectedPendingIds.slice(0, 1));
      expect(pendingPageBody.pagination.hasMore).toBe(true);
      expect(typeof pendingCursor).toBe('string');
      const pendingContinuation = await apiCall(friend, 'GET',
        `/users/${author.id}/posts?limit=1&cursor=${encodeURIComponent(pendingCursor)}`);
      expect(pendingContinuation.status()).toBe(200);
      const pendingContinuationBody = await pendingContinuation.json();
      expect(pendingContinuationBody.items.map((item: { id: string }) => item.id)).toEqual(expectedPendingIds.slice(1, 2));
      expect(pendingContinuationBody.pagination.hasMore).toBe(false);
      expect((await apiCall(author, 'GET', `/users/${author.id}/posts?limit=1&cursor=${encodeURIComponent(pendingCursor)}`)).status()).toBe(422);
      expect((await apiCall(stranger, 'GET', `/users/${author.id}/posts?limit=1&cursor=${encodeURIComponent(pendingCursor)}`)).status()).toBe(422);
      const accepted = await acceptFriendship(scenario, author, intent);
      expect(accepted.relationship.friendshipId).toMatch(/^[0-9a-f-]{36}$/iu);
      expect((await apiCall(friend, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(200);
      expect((await apiCall(friend, 'GET', `/users/${author.id}/posts`)).status()).toBe(200);
      expect((await apiCall(author, 'GET', `/posts/${membersOnly.id}`)).status()).toBe(200);
    });

    await test.step('PF-10 unfriend invalidates protected feed/profile access; re-friend restores historical access', async () => {
      const originalFriendshipId = scenario.manifest.fixtures.friendships[0]?.friendshipIds.at(-1);
      expect(originalFriendshipId).toBeTruthy();
      await friend.page.goto(`/thanh-vien/${author.id}`);
      const remove = friend.page.getByRole('button', { name: 'Hủy kết bạn' });
      await remove.click();
      await friend.page.getByRole('group', { name: 'Xác nhận hủy kết bạn' }).getByRole('button', { name: 'Xác nhận hủy' }).click();
      await expect(friend.page.getByRole('button', { name: 'Kết bạn', exact: true })).toBeVisible();
      expect((await apiCall(friend, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(404);
      expect((await apiCall(friend, 'GET', `/users/${author.id}/posts`)).status()).toBe(200);
      const profileItems = (await (await apiCall(friend, 'GET', `/users/${author.id}/posts`)).json()).items;
      expect(profileItems.some((item: { id: string }) => item.id === membersOnly.id)).toBe(true);
      expect(profileItems.some((item: { id: string }) => item.id === friendsOnly.id)).toBe(false);
      const unfriendedFeed = await apiCall(friend, 'GET', '/feed');
      expect(unfriendedFeed.status()).toBe(200);
      const feedItems = (await unfriendedFeed.json()).items;
      expect(feedItems.some((item: { id: string }) => item.id === friendsOnly.id)).toBe(false);
      expect((await apiCall(friend, 'GET', `/posts/${membersOnly.id}`)).status()).toBe(200);

      const newIntent = await requestFriendship(scenario, friend, author);
      const refriended = await acceptFriendship(scenario, author, newIntent);
      expect(refriended.relationship.friendshipId).not.toBe(originalFriendshipId);
      expect((await apiCall(friend, 'GET', `/posts/${friendsOnly.id}`)).status()).toBe(200);
      const refriendedFeed = await apiCall(friend, 'GET', '/feed');
      expect((await refriendedFeed.json()).items.some((item: { id: string }) => item.id === friendsOnly.id)).toBe(true);
    });

    await test.step('PF-11 lists expose no hidden item counts or hidden cursor anchors', async () => {
      const expectedVisibleIds = (await readMemberPostsOracle(scenario, author.id))
        .filter((post) => post.visibility === 'members')
        .map((post) => post.id);
      const list = await apiCall(stranger, 'GET', `/users/${author.id}/posts?limit=1`);
      expect(list.status()).toBe(200);
      const body = await list.json();
      expect(Object.keys(body).sort()).toEqual(['items', 'pagination']);
      expect(JSON.stringify(body)).not.toMatch(/total|hiddenCount|friends-only|email|passwordHash/iu);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual(expectedVisibleIds.slice(0, 1));
      expect(body.pagination).not.toHaveProperty('total');
      expect(body.pagination.hasMore).toBe(true);
      expect(body.pagination.nextCursor).toEqual(expect.any(String));
      const nextPage = await apiCall(stranger, 'GET',
        `/users/${author.id}/posts?limit=1&cursor=${encodeURIComponent(body.pagination.nextCursor)}`);
      expect(nextPage.status()).toBe(200);
      const nextBody = await nextPage.json();
      expect(nextBody.items.map((item: { id: string }) => item.id)).toEqual(expectedVisibleIds.slice(1, 2));
      expect(nextBody.pagination.hasMore).toBe(false);
      expect([...body.items, ...nextBody.items].map((item: { id: string }) => item.id)).toEqual(expectedVisibleIds);
      expect(expectedVisibleIds).toHaveLength(2);
      expect(expectedVisibleIds).not.toContain(friendsOnly.id);

      const ownerIds = await readMemberProfileIds(author, author.id);
      const acceptedFriendIds = await readMemberProfileIds(friend, author.id);
      const strangerIds = await readMemberProfileIds(stranger, author.id);
      expect(await readFirstTwoMemberProfileIds(author, author.id))
        .toEqual((await readVisibleMemberProfileOracle(scenario, author.id, author.id)).slice(0, 2));
      expect(await readFirstTwoMemberProfileIds(friend, author.id))
        .toEqual((await readVisibleMemberProfileOracle(scenario, friend.id, author.id)).slice(0, 2));
      expect(await readFirstTwoMemberProfileIds(stranger, author.id))
        .toEqual((await readVisibleMemberProfileOracle(scenario, stranger.id, author.id)).slice(0, 2));
      for (const post of [olderMembersOnly, membersOnly, friendsOnly]) expect(ownerIds).toContain(post.id);
      for (const post of [olderMembersOnly, membersOnly, friendsOnly]) expect(acceptedFriendIds).toContain(post.id);
      for (const post of [olderMembersOnly, membersOnly]) expect(strangerIds).toContain(post.id);
      expect(strangerIds).not.toContain(friendsOnly.id);
    });

    await test.step('PF-12 true cursor pagination, stable order and UUID tie-break through the UI', async () => {
      const repository = scenario.appModule.get((await import('../../../apps/api/dist/modules/posts/posts.repository.js')).PostsRepository);
      const tieAt = new Date(Date.now() - 30_000).toISOString();
      const seeded = [] as Array<{ id: string; authorId: string; content: string; createdAt: string; visibility: 'friends' | 'members' }>;
      for (let index = 0; index < 25; index += 1) {
        const authorId = index < 21 ? author.id : friend.id;
        const id = randomUUID();
        const marker = markerFor(`page-${index}`);
        const createdAt = index < 3 ? tieAt : new Date(Date.now() - (index + 40) * 1_000).toISOString();
        const visibility = index % 2 ? 'friends' : 'members';
        const content = `Feed ${index} ${marker}`;
        await reserveScenarioPost(scenario, { authorId, marker, visibility });
        const result = await repository.create({ id, authorId, content, visibility, createdAt });
        expect(result.id).toBe(id);
        await recordScenarioPost(scenario, { authorId, marker, postId: id });
        seeded.push({ id, authorId, content, createdAt, visibility });
      }
      const unrelatedMarker = markerFor('unrelated-member');
      await reserveScenarioPost(scenario, { authorId: stranger.id, marker: unrelatedMarker, visibility: 'members' });
      const outsiderId = randomUUID();
      await repository.create({
        id: outsiderId, authorId: stranger.id, content: `Outside feed ${unrelatedMarker}`,
        visibility: 'members', createdAt: new Date().toISOString(),
      });
      await recordScenarioPost(scenario, { authorId: stranger.id, marker: unrelatedMarker, postId: outsiderId });

      const expected = await readFeedOracle(scenario, author.id);
      await author.page.goto('/bang-tin');
      const list = author.page.getByLabel('Danh sách bài viết');
      await expect(list.locator('.post-card')).toHaveCount(20);
      await loadAllPostPages(author.page, '/feed');
      const cards = await author.page.locator('.post-card-content').allTextContents();
      const actual = cards.map((content) => expected.find((post) => post.content === content)?.id).filter(Boolean);
      expect(actual).toEqual(expected.map((post) => post.id));
      expect(actual).not.toContain(outsiderId);
      expect(seeded.every((post) => expected.some((item) => item.id === post.id))).toBe(true);
      const tiedIds = seeded.filter((post) => post.createdAt === tieAt).map((post) => post.id).sort().reverse();
      expect(expected.filter((item) => tiedIds.includes(item.id)).map((item) => item.id)).toEqual(tiedIds);
      const expectedProfile = await readMemberPostsOracle(scenario, author.id);
      await author.page.goto('/ho-so');
      const profileList = author.page.getByLabel('Danh sách bài viết');
      await expect(profileList.locator('.post-card')).toHaveCount(20);
      await loadAllPostPages(author.page, `/users/${author.id}/posts`);
      const profileContents = await profileList.locator('.post-card-content').allTextContents();
      expect(profileContents).toEqual(expectedProfile.map((post) => post.content));
      await friend.page.goto('/bang-tin');
      const friendFeed = friend.page.getByLabel('Danh sách bài viết');
      await expect(friendFeed.locator('.post-card')).toHaveCount(20);
    });

    await test.step('PF-13 cursor scope/viewer binding, malformed reuse and deleted-anchor continuation', async () => {
      const first = await apiCall(author, 'GET', '/feed?limit=2');
      expect(first.status()).toBe(200);
      const firstPage = await first.json();
      const oracleBeforeDelete = await readFeedOracle(scenario, author.id);
      expect(firstPage.items.map((item: { id: string }) => item.id)).toEqual(oracleBeforeDelete.slice(0, 2).map((item) => item.id));
      const cursor = firstPage.pagination.nextCursor;
      expect(typeof cursor).toBe('string');
      expect((await apiCall(friend, 'GET', `/feed?limit=2&cursor=${encodeURIComponent(cursor)}`)).status()).toBe(422);
      expect((await apiCall(author, 'GET', `/users/${author.id}/posts?limit=2&cursor=${encodeURIComponent(cursor)}`)).status()).toBe(422);
      expect((await apiCall(author, 'GET', `/users/${friend.id}/posts?limit=2&cursor=${encodeURIComponent(cursor)}`)).status()).toBe(422);
      const profileFirst = await apiCall(author, 'GET', `/users/${author.id}/posts?limit=2`);
      const profileCursor = (await profileFirst.json()).pagination.nextCursor;
      expect(typeof profileCursor).toBe('string');
      expect((await apiCall(author, 'GET', `/feed?limit=2&cursor=${encodeURIComponent(profileCursor)}`)).status()).toBe(422);
      expect((await apiCall(author, 'GET', `/users/${friend.id}/posts?limit=2&cursor=${encodeURIComponent(profileCursor)}`)).status()).toBe(422);
      expect((await apiCall(author, 'GET', `/feed?limit=2&cursor=${'x'.repeat(600)}`)).status()).toBe(422);
      const anchor = firstPage.items.at(-1);
      const removedAnchor = await apiCall(author, 'DELETE', `/posts/${anchor.id}?expectedVersion=${anchor.version}`);
      expect(removedAnchor.status()).toBe(204);
      const continuation = await apiCall(author, 'GET', `/feed?limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(continuation.status()).toBe(200);
      const continuedItems = (await continuation.json()).items;
      expect(continuedItems.map((item: { id: string }) => item.id)).toEqual(oracleBeforeDelete.slice(2, 4).map((item) => item.id));
      expect(continuedItems.some((item: { id: string }) => item.id === anchor.id)).toBe(false);
    });

    await test.step('PF-14 refresh after create/delete, empty Feed/profile and Load More retry state', async () => {
      await author.page.goto('/bang-tin');
      await expect(author.page.getByLabel('Danh sách bài viết').locator('.post-card')).toHaveCount(20);
      await loadAllPostPages(author.page, '/feed');
      const previouslyLoaded = await author.page.locator('.post-card-content').allTextContents();
      expect(previouslyLoaded.length).toBeGreaterThan(20);

      const content = `Newest refresh ${markerFor('refresh')}`;
      const creatorPage = await author.context.newPage();
      const creator = { ...author, page: creatorPage };
      const newPost = await createPostFromComposer(scenario, creator, { content, visibility: 'friends' });
      await creatorPage.close();

      await author.page.getByRole('button', { name: /Tải mới/ }).click();
      await expect(author.page.locator('.post-card').filter({ hasText: newPost.content })).toBeVisible();
      await expect(author.page.locator('.post-card-content').first()).toHaveText(newPost.content);
      await loadAllPostPages(author.page, '/feed');
      const refreshedContents = await author.page.locator('.post-card-content').allTextContents();
      const refreshedOracle = await readFeedOracle(scenario, author.id);
      expect(refreshedContents).toEqual(refreshedOracle.map((post) => post.content));
      expect(refreshedContents.filter((value) => value === newPost.content)).toHaveLength(1);
      const newPostCard = author.page.locator('.post-card').filter({ hasText: newPost.content });
      await newPostCard.getByRole('button', { name: 'Xóa bài viết' }).click();
      const deleteResponse = waitForResponse(author.page, 'DELETE', `/api/posts/${newPost.id}`);
      await newPostCard.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
      expect((await deleteResponse).status()).toBe(204);
      await expect(newPostCard).toHaveCount(0);
      expect((await apiCall(author, 'GET', `/posts/${newPost.id}`)).status()).toBe(404);

      await empty.page.goto('/bang-tin');
      await expect(empty.page.getByText('Chưa có bài viết nào để hiển thị.')).toBeVisible();
      await expect(empty.page.getByRole('button', { name: /Tải mới/ })).toBeVisible();
      const privateAuthor = empty;
      const privatePost = await createPostFromComposer(scenario, privateAuthor, {
        content: `Ẩn với người lạ ${markerFor('hidden-profile')}`, visibility: 'friends',
      });
      await stranger.page.goto(`/thanh-vien/${privateAuthor.id}`);
      await expect(stranger.page.locator('.post-card').filter({ hasText: privatePost.content })).toHaveCount(0);
      const privateList = await apiCall(stranger, 'GET', `/users/${privateAuthor.id}/posts`);
      expect(privateList.status()).toBe(200);
      expect((await privateList.json()).items).toEqual([]);

    });
  } finally {
    await cleanupPostsScenario(scenario);
  }
});

for (const acceptanceCase of ['PF-15', 'PF-16', 'PF-17']) {
test(`${acceptanceCase} real concurrent mutations, stale recovery or session revocation @concurrency-recovery`, async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    let [author, other] = await loginActors(scenario, browser, scenario.users.slice(0, 2));
    const post = await createPostFromComposer(scenario, author, {
      content: `Concurrency ${markerFor('race')}`, visibility: 'friends',
    });
    const secondTab = await author.context.newPage();
    await secondTab.goto('/bang-tin');
    const cardA = author.page.locator('.post-card').filter({ hasText: post.content });
    const cardB = secondTab.locator('.post-card').filter({ hasText: post.content });

    if (acceptanceCase === 'PF-15') {
    await test.step('PF-15 genuinely overlapping edit/edit requests have one winner and one conflict', async () => {
      await author.page.goto('/bang-tin');
      await secondTab.goto('/bang-tin');
      await cardA.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      await cardB.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      await cardA.getByLabel('Chỉnh sửa nội dung bài viết').fill(`${post.content} from tab A`);
      await cardB.getByLabel('Chỉnh sửa nội dung bài viết').fill(`${post.content} from tab B`);
      const race = await overlapRequests(
        [author.page, secondTab], 'PATCH', `/api/posts/${post.id}`,
        [
          () => cardA.getByRole('button', { name: 'Lưu thay đổi' }).click(),
          () => cardB.getByRole('button', { name: 'Lưu thay đổi' }).click(),
        ],
      );
      expect(race.statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(race.statuses.filter((status) => status === 409)).toHaveLength(1);
      const stored = await apiCall(author, 'GET', `/posts/${post.id}`);
      expect(stored.status()).toBe(200);
      const authoritative = (await stored.json()).post;
      expect(authoritative.version).toBe(1);
      expect([`${post.content} from tab A`, `${post.content} from tab B`]).toContain(authoritative.content);
      expect(await readPostSnapshot(scenario, author.id, post.id)).toMatchObject({
        postCount: 1,
        authorshipCount: 1,
        content: authoritative.content,
        version: authoritative.version,
        visibility: post.visibility,
      });

      const pages = [author.page, secondTab];
      const winnerIndex = race.statuses.indexOf(200);
      const loserIndex = race.statuses.indexOf(409);
      const winnerCard = pages[winnerIndex]!.locator('.post-card').filter({ hasText: post.content });
      const loserCard = pages[loserIndex]!.locator('.post-card').filter({ hasText: post.content });
      const loserDraft = `${post.content} from tab ${loserIndex === 0 ? 'A' : 'B'}`;
      await expect(winnerCard.locator('.post-card-content')).toHaveText(authoritative.content);
      await expect(loserCard.getByText('Bản nháp vẫn được giữ. Tải phiên bản mới trước khi lưu tiếp.')).toBeVisible();
      await expect(loserCard.getByLabel('Chỉnh sửa nội dung bài viết')).toHaveValue(loserDraft);
      await loserCard.getByRole('button', { name: 'Tải phiên bản mới' }).click();
      await expect(loserCard.getByRole('status')).toContainText('Đã tải phiên bản mới');
      await expect(loserCard.getByLabel('Chỉnh sửa nội dung bài viết')).toHaveValue(loserDraft);
      await loserCard.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(loserCard.locator('.post-card-content')).toHaveText(authoritative.content);
    });

    await test.step('PF-15 genuinely overlapping edit/delete requests produce one definitive mutation', async () => {
      const current = (await (await apiCall(author, 'GET', `/posts/${post.id}`)).json()).post;
      await author.page.goto('/bang-tin');
      await secondTab.goto('/bang-tin');
      const editCard = author.page.locator('.post-card').filter({ hasText: current.content });
      const deleteCard = secondTab.locator('.post-card').filter({ hasText: current.content });
      await editCard.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      await editCard.getByLabel('Chỉnh sửa nội dung bài viết').fill(`${current.content} race edit`);
      await deleteCard.getByRole('button', { name: 'Xóa bài viết' }).click();
      const actions = await overlapRequests(
        [author.page, secondTab], 'PATCH', `/api/posts/${post.id}`,
        [
          () => editCard.getByRole('button', { name: 'Lưu thay đổi' }).click(),
          () => deleteCard.getByRole('button', { name: 'Xóa vĩnh viễn' }).click(),
        ],
        { methods: ['PATCH', 'DELETE'] },
      );
      expect(actions.statuses.filter((status) => status === 200 || status === 204)).toHaveLength(1);
      expect(actions.statuses.every((status) => [200, 204, 404, 409].includes(status))).toBe(true);
      const final = await apiCall(author, 'GET', `/posts/${post.id}`);
      expect([200, 404]).toContain(final.status());
      const persistedFinal = await readPostSnapshot(scenario, author.id, post.id);
      if (final.status() === 200) {
        const finalPost = (await final.json()).post;
        expect(finalPost.version).toBe(current.version + 1);
        expect(persistedFinal).toMatchObject({
          postCount: 1,
          authorshipCount: 1,
          content: finalPost.content,
          version: finalPost.version,
          visibility: current.visibility,
        });
        expect(actions.statuses).toEqual([200, 409]);
        await expect(editCard.locator('.post-card-content')).toHaveText(finalPost.content);
        await expect(deleteCard.getByRole('button', { name: 'Xóa vĩnh viễn' })).toBeDisabled();
        await expect(deleteCard.getByRole('button', { name: 'Tải phiên bản mới' })).toBeVisible();
        await deleteCard.getByRole('button', { name: 'Tải phiên bản mới' }).click();
        await expect(deleteCard.getByRole('status')).toContainText('Đã tải phiên bản mới');
        await deleteCard.getByRole('button', { name: 'Hủy', exact: true }).click();
        await expect(deleteCard.locator('.post-card-content')).toHaveText(finalPost.content);
      } else {
        expect(actions.statuses).toEqual([404, 204]);
        expect(persistedFinal).toMatchObject({ postCount: 0, authorshipCount: 0 });
        await expect(editCard).toHaveCount(0);
        await expect(deleteCard).toHaveCount(0);
      }
    });

    }

    if (acceptanceCase === 'PF-16') await test.step('PF-16 sequential stale expectedVersion conflict retains draft and requires explicit reload', async () => {
      const stale = await createPostFromComposer(scenario, author, {
        content: `Stale recovery ${markerFor('stale-edit')}`, visibility: 'friends',
      });
      const latest = await createPostFromComposer(scenario, other, {
        content: `Other actor ${markerFor('other')}`, visibility: 'members',
      });
      const aCard = author.page.locator('.post-card').filter({ hasText: stale.content });
      await author.page.goto('/bang-tin');
      await aCard.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      const draft = `${stale.content} my draft`;
      await aCard.getByLabel('Chỉnh sửa nội dung bài viết').fill(draft);
      const external = await apiCall(author, 'PATCH', `/posts/${stale.id}`, {
        content: `${stale.content} external`, expectedVersion: stale.version,
      });
      expect(external.status()).toBe(200);
      const conflictPromise = waitForResponse(author.page, 'PATCH', `/api/posts/${stale.id}`);
      await aCard.getByRole('button', { name: 'Lưu thay đổi' }).click();
      expect((await conflictPromise).status()).toBe(409);
      await expect(aCard.getByLabel('Chỉnh sửa nội dung bài viết')).toHaveValue(draft);
      await expect(aCard.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
      await aCard.getByRole('button', { name: 'Tải phiên bản mới' }).click();
      await expect(aCard.getByRole('status')).toHaveText(
        'Đã tải phiên bản mới. Bản nháp vẫn được giữ lại; hãy kiểm tra trước khi lưu tiếp.',
      );
      await expect(aCard.getByLabel('Chỉnh sửa nội dung bài viết')).toHaveValue(draft);
      const retry = waitForResponse(author.page, 'PATCH', `/api/posts/${stale.id}`);
      await aCard.getByRole('button', { name: 'Lưu thay đổi' }).click();
      expect((await retry).status()).toBe(200);
      expect((await (await apiCall(author, 'GET', `/posts/${stale.id}`)).json()).post.version).toBe(2);
      expect((await apiCall(other, 'GET', `/posts/${latest.id}`)).status()).toBe(200);
    });

    if (acceptanceCase === 'PF-17') await test.step('PF-17 real logout revocation and exact owned-session expiry clear protected state', async () => {
      await author.page.goto('/bang-tin');
      const logoutObserver = await author.context.newPage();
      await logoutObserver.goto('/ho-so');
      const sessionBefore = await apiCall(author, 'GET', '/auth/session');
      expect(sessionBefore.status()).toBe(200);
      await logoutObserver.getByRole('button', { name: 'Đăng xuất' }).click();
      await expect(logoutObserver).toHaveURL(/\/dang-nhap/u);
      const protectedAfterLogout = await apiCall(author, 'GET', `/posts/${post.id}`);
      expect(protectedAfterLogout.status()).toBe(401);
      await author.page.reload();
      await expect(author.page).toHaveURL(/\/dang-nhap/u);
      await expect(author.page.locator('.post-card')).toHaveCount(0);
      await logoutObserver.close();

      author = await loginActor(browser, scenario, scenario.users[0]!);
      const expiredActor = author;
      const latestSession = await scenario.session.run(
        `MATCH (:User {id:$userId})-[:HAS_AUTH_SESSION]->(session:AuthSession)
         RETURN session.id AS id ORDER BY session.createdAt DESC LIMIT 1`,
        { userId: expiredActor.id },
      );
      const sessionId = String(latestSession.records[0]?.get('id') ?? '');
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/iu);
      const expiration = await scenario.session.executeWrite((tx) => tx.run(
        `MATCH (:User {id:$userId})-[:HAS_AUTH_SESSION]->(session:AuthSession {id:$sessionId})
         SET session.expiresAt = datetime('2000-01-01T00:00:00Z') RETURN session.id AS id`,
        { userId: expiredActor.id, sessionId },
      ));
      expect(expiration.records).toHaveLength(1);
      const expiredRead = await apiCall(expiredActor, 'GET', '/feed');
      expect(expiredRead.status()).toBe(401);
      expect((await apiCall(other, 'GET', '/feed')).status()).toBe(200);
      await expiredActor.page.goto('/bang-tin');
      await expiredActor.page.reload();
      await expect(expiredActor.page).toHaveURL(/\/dang-nhap/u);
      await expect(expiredActor.page.locator('.post-card')).toHaveCount(0);
      expect((await apiCall(expiredActor, 'GET', `/posts/${post.id}`)).status()).toBe(401);
      author = await loginActor(browser, scenario, scenario.users[0]!);
    });

  } finally {
    await cleanupPostsScenario(scenario);
  }
});

}

test('PF-18 SIMULATED edit and Feed transport recovery @concurrency-recovery', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author] = await loginActors(scenario, browser, scenario.users.slice(0, 1));
    await test.step('PF-18 SIMULATED aborted writes retain drafts and real retry creates once', async () => {
      const editPost = await createPostFromComposer(scenario, author, {
        content: `Edit transport retry ${markerFor('abort-edit')}`, visibility: 'friends',
      });
      await author.page.goto('/bang-tin');
      const editCard = author.page.locator('.post-card').filter({ hasText: editPost.content });
      await editCard.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
      const editDraft = `${editPost.content} draft retained`;
      await editCard.getByLabel('Chỉnh sửa nội dung bài viết').fill(editDraft);
      let patchAttempts = 0;
      const countPatchAttempts = (request: { method(): string; url(): string }) => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/posts/${editPost.id}`) patchAttempts += 1;
      };
      const abortEdit = async (route: Route) => {
        if (route.request().method() === 'PATCH' && new URL(route.request().url()).pathname === `/api/posts/${editPost.id}`) {
          await route.abort();
          return;
        }
        await route.continue();
      };
      author.page.on('request', countPatchAttempts);
      await author.page.route('**/api/posts/**', abortEdit);
      try {
        await editCard.getByRole('button', { name: 'Lưu thay đổi' }).click();
        await expect(editCard.getByRole('alert')).toContainText('Không thể kết nối');
        await expect(editCard.getByLabel('Chỉnh sửa nội dung bài viết')).toHaveValue(editDraft);
      } finally {
        await author.page.unroute('**/api/posts/**', abortEdit);
      }
      const unchanged = await apiCall(author, 'GET', `/posts/${editPost.id}`);
      expect((await unchanged.json()).post.content).toBe(editPost.content);
      const editRetry = waitForResponse(author.page, 'PATCH', `/api/posts/${editPost.id}`);
      await editCard.getByRole('button', { name: 'Lưu thay đổi' }).click();
      expect((await editRetry).status()).toBe(200);
      expect(patchAttempts).toBe(2);
      author.page.off('request', countPatchAttempts);
      await expect(editCard.locator('.post-card-content')).toHaveText(editDraft);
      const loadedContents = await author.page.locator('.post-card-content').allTextContents();
      expect(loadedContents).toContain(editDraft);

      const failInitialList = async (route: Route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'GET' && url.pathname === '/api/feed' && !url.searchParams.has('cursor')) {
          await route.abort();
          return;
        }
        await route.continue();
      };
      await author.page.route('**/api/feed**', failInitialList);
      try {
        await author.page.getByRole('button', { name: /Tải mới/ }).click();
        await expect(author.page.locator('.posts-list-error').getByRole('alert')).toBeVisible();
        await expect(author.page.locator('.post-card-content')).toHaveText(loadedContents);
      } finally {
        await author.page.unroute('**/api/feed**', failInitialList);
      }
      await author.page.getByRole('button', { name: 'Thử tải lại' }).click();
      await expect(author.page.locator('.posts-list-error')).toHaveCount(0);
      await expect(author.page.locator('.post-card-content')).toHaveText(loadedContents);

      const repository = scenario.appModule.get((await import('../../../apps/api/dist/modules/posts/posts.repository.js')).PostsRepository);
      for (let index = 0; index < 21; index += 1) {
        const id = randomUUID();
        const marker = markerFor(`retry-page-${index}`);
        const createdAt = new Date(Date.now() - (index + 300) * 1_000).toISOString();
        const content = `Retry page ${index} ${marker}`;
        await reserveScenarioPost(scenario, { authorId: author.id, marker, visibility: 'friends' });
        const created = await repository.create({
          id, authorId: author.id, content, visibility: 'friends', createdAt,
        });
        expect(created?.id).toBe(id);
        await recordScenarioPost(scenario, { authorId: author.id, marker, postId: id });
      }
      await author.page.goto('/bang-tin');
      await expect(author.page.locator('.post-card')).toHaveCount(20);
      await expect(author.page.getByRole('button', { name: 'Tải thêm bài viết' })).toBeVisible();
      const expectedFeedCount = (await readFeedOracle(scenario, author.id)).length;
      let heldCursor = '';
      const retriedCursors: string[] = [];
      const recordCursor = (request: { method(): string; url(): string }) => {
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.pathname === '/api/feed' && url.searchParams.has('cursor')) {
          const cursor = url.searchParams.get('cursor') ?? '';
          retriedCursors.push(cursor);
          if (!heldCursor) heldCursor = cursor;
        }
      };
      const abortLoadMore = async (route: Route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'GET' && url.pathname === '/api/feed' && url.searchParams.has('cursor')) {
          await route.abort();
          return;
        }
        await route.continue();
      };
      author.page.on('request', recordCursor);
      await author.page.route('**/api/feed**', abortLoadMore);
      try {
        await author.page.getByRole('button', { name: 'Tải thêm bài viết' }).click();
        await expect(author.page.getByRole('alert')).toBeVisible();
        await expect(author.page.locator('.post-card')).toHaveCount(20);
      } finally {
        await author.page.unroute('**/api/feed**', abortLoadMore);
      }
      expect(heldCursor).not.toBe('');
      await author.page.getByRole('button', { name: 'Thử tải thêm' }).click();
      await expect(author.page.locator('.post-card')).toHaveCount(expectedFeedCount);
      expect(retriedCursors).toHaveLength(2);
      expect(retriedCursors[1]).toBe(heldCursor);

    });
  } finally {
    await cleanupPostsScenario(scenario);
  }
});

test('PF-18 SIMULATED aborted create requires reconciliation before retry @concurrency-recovery', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author] = await loginActors(scenario, browser, scenario.users.slice(0, 1));
    await test.step('PF-18 unknown create outcome retains draft and prevents automatic retry', async () => {
      const simulated = markerFor('abort-create');
      await author.page.goto('/bang-tin');
      const composer = author.page.getByLabel('Nội dung bài viết');
      await composer.fill(`Transport retry ${simulated}`);
      const intentMarker = simulated;
      await reserveScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker: intentMarker, visibility: 'friends' });
      const abortPost = async (route: Route) => {
        if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/posts') {
          signalAbort();
          await abortRelease;
          await route.abort();
          return;
        }
        await route.continue();
      };
      let signalAbort!: () => void;
      let releaseAbort!: () => void;
      const abortArrived = new Promise<void>((resolve) => { signalAbort = resolve; });
      const abortRelease = new Promise<void>((resolve) => { releaseAbort = resolve; });
      let postAttempts = 0;
      const countPostAttempts = (request: { method(): string; url(): string }) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/posts') postAttempts += 1;
      };
      author.page.on('request', countPostAttempts);
      await author.page.route('**/api/posts', abortPost);
      try {
        const submit = author.page.getByRole('button', { name: 'Đăng bài' });
        const pendingClick = submit.click();
        await abortArrived;
        await expect(author.page.getByRole('button', { name: 'Đang đăng…' })).toBeDisabled();
        expect(postAttempts).toBe(1);
        releaseAbort();
        await pendingClick;
        await expect(author.page.getByRole('alert')).toContainText('Chưa thể xác nhận kết quả đăng bài');
        await expect(composer).toHaveValue(`Transport retry ${simulated}`);
        await expect(author.page.getByRole('button', { name: 'Đăng bài' })).toBeDisabled();
        expect(postAttempts).toBe(1);
      } finally {
        releaseAbort();
        await author.page.unroute('**/api/posts', abortPost);
      }
      await author.page.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }).click();
      await expect(author.page.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).toBeVisible();
      expect(postAttempts).toBe(1);
      expect(await countPostByMarker(scenario, scenario.users[0]!.id, intentMarker)).toBe(0);
      await author.page.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' }).click();
      const retryResponse = waitForResponse(author.page, 'POST', '/api/posts');
      await author.page.getByRole('button', { name: 'Đăng bài' }).click();
      const successfulRetry = await retryResponse;
      expect(successfulRetry.status()).toBe(201);
      const created = (await successfulRetry.json()).post;
      await recordScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker: intentMarker, postId: created.id });
      expect(await countPostByMarker(scenario, scenario.users[0]!.id, intentMarker)).toBe(1);
      expect(postAttempts).toBe(2);
      author.page.off('request', countPostAttempts);
    });

  } finally {
    await cleanupPostsScenario(scenario);
  }
});

for (const outcome of ['lost-response', 'explicit-unknown']) {
test(`PF-19 SIMULATED ${outcome} reconciliation @concurrency-recovery`, async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author] = await loginActors(scenario, browser, scenario.users.slice(0, 1));
    await test.step('PF-19 SIMULATED lost response after real commit reconciles one persisted Post without auto-retry', async () => {
      if (outcome === 'lost-response') {
      const marker = markerFor('lost-response');
      const content = `Committed response lost ${marker}`;
      await author.page.goto('/bang-tin');
      await author.page.getByLabel('Nội dung bài viết').fill(content);
      await reserveScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker, visibility: 'friends' });
      let observedPostId = '';
      let postAttempts = 0;
      const countPostAttempts = (request: { method(): string; url(): string }) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/posts') postAttempts += 1;
      };
      author.page.on('request', countPostAttempts);
      const suppressCommittedResponse = async (route: Route) => {
        if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== '/api/posts') {
          await route.continue();
          return;
        }
        const upstream = await route.fetch();
        expect(upstream.status()).toBe(201);
        const body = await upstream.json();
        observedPostId = body.post.id;
        await recordScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker, postId: observedPostId });
        await route.abort();
      };
      await author.page.route('**/api/posts', suppressCommittedResponse);
      try {
        await author.page.getByRole('button', { name: 'Đăng bài' }).click();
        await expect(author.page.getByRole('alert')).toBeVisible();
        await expect(author.page.getByLabel('Nội dung bài viết')).toHaveValue(content);
        expect((await countPostById(scenario, observedPostId))).toBe(1);
      } finally {
        await author.page.unroute('**/api/posts', suppressCommittedResponse);
        author.page.off('request', countPostAttempts);
      }
      expect(postAttempts).toBe(1);
      await author.page.getByRole('button', { name: 'Tải mới' }).click();
      await expect(author.page.locator('.post-card').filter({ hasText: content })).toBeVisible();
      expect(await countPostById(scenario, observedPostId)).toBe(1);
      await author.page.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }).click();
      await author.page.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' }).click();

      }
      if (outcome === 'explicit-unknown') {
      await author.page.goto('/bang-tin');
      const unknownMarker = markerFor('unknown-outcome');
      const unknownContent = `Unknown outcome reconciliation ${unknownMarker}`;
      await author.page.getByLabel('Nội dung bài viết').fill(unknownContent);
      await reserveScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker: unknownMarker, visibility: 'friends' });
      let unknownAttempts = 0;
      const countUnknownAttempts = (request: { method(): string; url(): string }) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/posts') unknownAttempts += 1;
      };
      const injectUnknownOutcome = async (route: Route) => {
        if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/posts') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
            error: { statusCode: 503, code: 'WRITE_OUTCOME_UNKNOWN', message: 'Kết quả ghi chưa xác định.' },
          }) });
          return;
        }
        await route.continue();
      };
      author.page.on('request', countUnknownAttempts);
      await author.page.route('**/api/posts', injectUnknownOutcome);
      try {
        await author.page.getByRole('button', { name: 'Đăng bài' }).click();
        await expect(author.page.getByRole('alert')).toContainText('Không gửi lại tự động');
        expect(unknownAttempts).toBe(1);
        await author.page.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }).click();
        await author.page.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' }).click();
      } finally {
        await author.page.unroute('**/api/posts', injectUnknownOutcome);
        author.page.off('request', countUnknownAttempts);
      }
      const manualRetry = waitForResponse(author.page, 'POST', '/api/posts');
      await author.page.getByRole('button', { name: 'Đăng bài' }).click();
      const recovered = await manualRetry;
      expect(recovered.status()).toBe(201);
      const recoveredPost = (await recovered.json()).post;
      await recordScenarioPost(scenario, { authorId: scenario.users[0]!.id, marker: unknownMarker, postId: recoveredPost.id });
      expect(unknownAttempts).toBe(1);
      }
    });

  } finally {
    await cleanupPostsScenario(scenario);
  }
});

}

test('PF-20 controlled stale Feed delivery and route changes @concurrency-recovery', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author, other] = await loginActors(scenario, browser, scenario.users.slice(0, 2));
    await test.step('PF-20 controlled stale Feed delivery cannot restore revoked Posts or append to another page', async () => {
      const delayedPost = await createPostFromComposer(scenario, author, {
        content: `Delayed response ${markerFor('delayed-read')}`, visibility: 'friends',
      });
      const deletedPost = await createPostFromComposer(scenario, author, {
        content: `Deleted during stale response ${markerFor('deleted-delivery')}`, visibility: 'friends',
      });
      await createPostFromComposer(scenario, other, {
        content: `Own profile baseline ${markerFor('profile-baseline')}`, visibility: 'friends',
      });
      const initialIntent = await requestFriendship(scenario, other, author);
      const initialFriendship = await acceptFriendship(scenario, author, initialIntent);
      const friendshipId = initialFriendship.relationship.friendshipId as string;
      await other.page.goto('/bang-tin');
      await expect(other.page.locator('.post-card').filter({ hasText: delayedPost.content })).toBeVisible();
      await expect(other.page.locator('.post-card').filter({ hasText: deletedPost.content })).toBeVisible();

      let holdNext = false;
      let pendingDelivery: ControlledFeedDelivery | undefined;
      const deliveries: ControlledFeedDelivery[] = [];
      const holdNextFeed = () => {
        const delivery = createControlledFeedDelivery();
        deliveries.push(delivery);
        pendingDelivery = delivery;
        holdNext = true;
        return delivery;
      };
      const holdOldRead = async (route: Route) => {
        if (holdNext && route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/feed') {
          holdNext = false;
          const held = pendingDelivery!;
          pendingDelivery = undefined;
          held.started = true;
          try {
            const response = await route.fetch();
            const body = await response.json();
            held.hasPost = body.items.some((item: { id: string }) => item.id === delayedPost.id);
            held.hasDeletedPost = body.items.some((item: { id: string }) => item.id === deletedPost.id);
            held.arrive();
            await held.gate;
            try {
              await route.fulfill({ response, body: JSON.stringify(body) });
              held.delivered = true;
            } catch {
              held.delivered = false;
            }
          } catch (cause) {
            held.arrive();
            throw cause;
          } finally {
            held.settle();
          }
          return;
        }
        await route.continue();
      };
      await other.page.route('**/api/feed**', holdOldRead);
      try {
        const staleBeforeUnfriend = holdNextFeed();
        await other.page.getByRole('button', { name: 'Tải mới' }).click();
        await staleBeforeUnfriend.arrival;
        expect(staleBeforeUnfriend.hasPost).toBe(true);
        expect(staleBeforeUnfriend.hasDeletedPost).toBe(true);
        await expect(other.page.locator('.posts-loading')).toHaveText('Đang tải bài viết…');

        await author.page.goto('/bang-tin');
        const deletedCard = author.page.locator('.post-card').filter({ hasText: deletedPost.content });
        await deletedCard.getByRole('button', { name: 'Xóa bài viết' }).click();
        const deleteResponse = waitForResponse(author.page, 'DELETE', `/api/posts/${deletedPost.id}`);
        await deletedCard.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
        expect((await deleteResponse).status()).toBe(204);
        expect((await apiCall(other, 'GET', `/posts/${deletedPost.id}`)).status()).toBe(404);

        await author.page.goto(`/thanh-vien/${other.id}`);
        await author.page.getByRole('button', { name: 'Hủy kết bạn' }).click();
        const unfriendResponse = waitForResponse(author.page, 'DELETE', `/api/friendships/${friendshipId}`);
        await author.page.getByRole('group', { name: 'Xác nhận hủy kết bạn' }).getByRole('button', { name: 'Xác nhận hủy' }).click();
        expect((await unfriendResponse).status()).toBe(204);
        expect((await apiCall(other, 'GET', `/posts/${delayedPost.id}`)).status()).toBe(404);

        const currentFeedResponse = waitForResponse(other.page, 'GET', '/api/feed');
        await other.page.getByRole('button', { name: 'Tải mới' }).click();
        await expect(other.page.locator('.posts-loading')).toHaveText('Đang tải bài viết…');
        const currentFeed = await currentFeedResponse;
        expect(currentFeed.status()).toBe(200);
        const currentItems = (await currentFeed.json()).items;
        expect(currentItems.some((item: { id: string }) => item.id === delayedPost.id)).toBe(false);
        expect(currentItems.some((item: { id: string }) => item.id === deletedPost.id)).toBe(false);
        await expect(other.page.locator('.post-card').filter({ hasText: delayedPost.content })).toHaveCount(0);
        await expect(other.page.locator('.post-card').filter({ hasText: deletedPost.content })).toHaveCount(0);

        staleBeforeUnfriend.release();
        await staleBeforeUnfriend.settled;
        expect(staleBeforeUnfriend.delivered).toBe(true);
        await expect(other.page.locator('.post-card').filter({ hasText: delayedPost.content })).toHaveCount(0);
        await expect(other.page.locator('.post-card').filter({ hasText: deletedPost.content })).toHaveCount(0);

        const restoredIntent = await requestFriendship(scenario, other, author);
        const restored = await acceptFriendship(scenario, author, restoredIntent);
        expect(restored.relationship.friendshipId).not.toBe(friendshipId);
        expect((await apiCall(other, 'GET', `/posts/${delayedPost.id}`)).status()).toBe(200);
        expect((await apiCall(other, 'GET', `/posts/${deletedPost.id}`)).status()).toBe(404);

        await other.page.goto('/bang-tin');
        await expect(other.page.locator('.post-card').filter({ hasText: delayedPost.content })).toBeVisible();
        const staleForProfile = holdNextFeed();
        await other.page.getByRole('button', { name: 'Tải mới' }).click();
        await staleForProfile.arrival;
        expect(staleForProfile.hasPost).toBe(true);
        expect(staleForProfile.hasDeletedPost).toBe(false);

        await other.page.goto('/ho-so');
        await expect(other.page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
        await expect(other.page.getByLabel('Danh sách bài viết').locator('.post-card').first()).toBeVisible();
        const profileCardCount = await other.page.locator('.post-card').count();
        await other.page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
        await other.page.getByLabel('Tên hiển thị').fill('PF20 newest profile state');
        await other.page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
        await expect(other.page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');
        staleForProfile.release();
        await staleForProfile.settled;
        expect(staleForProfile.delivered).toBe(true);
        await expect(other.page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
        await expect(other.page.getByText('PF20 newest profile state')).toBeVisible();
        await expect(other.page.getByText(delayedPost.content)).toHaveCount(0);
        expect(await other.page.locator('.post-card').count()).toBe(profileCardCount);
      } finally {
        for (const delivery of deliveries) delivery.release();
        await Promise.all(deliveries.filter((delivery) => delivery.started).map((delivery) => delivery.settled));
        await other.page.unroute('**/api/feed**', holdOldRead);
      }
    });
  } finally {
    await cleanupPostsScenario(scenario);
  }
});

test('PF-21–PF-23 approved Weylume UI, responsive/accessibility checks and V5 compatibility @ux-compatibility', async ({ browser }) => {
  const scenario = await createPostsScenario({ actorCount: 3 });
  try {
    const [author, member] = await loginActors(scenario, browser, scenario.users.slice(0, 2));
    const ownPost = await createPostFromComposer(scenario, author, {
      content: `Long Vietnamese text: ${'tiếng Việt và kết nối '.repeat(15)}${'x'.repeat(80)} ${markerFor('responsive-own')}`,
      visibility: 'friends',
    });
    const memberPost = await createPostFromComposer(scenario, member, {
      content: `Member profile text: ${'Weylume cộng đồng '.repeat(12)} ${markerFor('responsive-member')}`,
      visibility: 'members',
    });
    await test.step('PF-21 all required pages and responsive/accessibility behavior at four viewports', async () => {
      const pages = [
        ['/bang-tin', 'Bảng tin', ownPost.content],
        [`/bai-viet/${memberPost.id}`, 'Bài viết', memberPost.content],
        ['/ho-so', 'Hồ sơ của tôi', ownPost.content],
        [`/thanh-vien/${member.id}`, 'Hồ sơ thành viên', memberPost.content],
      ] as const;
      const consoleErrors: string[] = [];
      author.page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push('console-error'); });
      const failedRequests: string[] = [];
      author.page.on('requestfailed', (request) => {
        if (!request.failure()?.errorText.includes('ERR_ABORTED')) failedRequests.push('request-failed');
      });
      const viewports = [
        { width: 1440, height: 900 }, { width: 768, height: 1024 },
        { width: 390, height: 844 }, { width: 320, height: 740 },
      ];
      for (const viewport of viewports) {
        await author.page.setViewportSize(viewport);
        for (const [path, heading, content] of pages) {
          await author.page.goto(path);
          await expect(author.page.getByRole('heading', { name: heading })).toBeVisible();
          await expect(author.page.getByText(content).first()).toBeVisible();
          if (path === '/bang-tin') {
            await expect(author.page.getByRole('textbox', { name: 'Nội dung bài viết' })).toBeVisible();
            await expect(author.page.getByLabel('Ai có thể xem?')).toHaveValue('friends');
            await expect(author.page.getByRole('button', { name: 'Đăng bài' })).toBeVisible();
            const ownCard = author.page.locator('.post-card').filter({ hasText: ownPost.content });
            await expect(ownCard.getByText('Chỉ bạn bè')).toBeVisible();
            await expect(ownCard.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toBeVisible();
            await expect(ownCard.getByRole('button', { name: 'Xóa bài viết' })).toBeVisible();
            expect(await author.page.locator('body').ariaSnapshot()).toContain('textbox "Nội dung bài viết"');
            await captureUiInspectionScreenshot(author.page, `feed-${viewport.width}x${viewport.height}`);
          } else if (path.startsWith('/bai-viet/')) {
            const detailCard = author.page.locator('.post-card').filter({ hasText: content });
            await expect(detailCard.getByText('Thành viên Weylume')).toBeVisible();
            await expect(detailCard.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toHaveCount(0);
            await expect(detailCard.getByRole('button', { name: 'Xóa bài viết' })).toHaveCount(0);
            if (viewport.width === 1440) await captureUiInspectionScreenshot(author.page, 'post-detail');
          } else if (path === '/ho-so') {
            const ownCard = author.page.locator('.post-card').filter({ hasText: content });
            await expect(ownCard.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toBeVisible();
            await expect(ownCard.getByRole('button', { name: 'Xóa bài viết' })).toBeVisible();
            if (viewport.width === 1440) await captureUiInspectionScreenshot(author.page, 'own-profile-posts');
          } else {
            const memberCard = author.page.locator('.post-card').filter({ hasText: content });
            await expect(memberCard.getByText('Thành viên Weylume')).toBeVisible();
            await expect(memberCard.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toHaveCount(0);
            await expect(memberCard.getByRole('button', { name: 'Xóa bài viết' })).toHaveCount(0);
            if (viewport.width === 1440) await captureUiInspectionScreenshot(author.page, 'member-profile-posts');
          }
          const geometry = await author.page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            composer: document.querySelector('.posts-composer')?.getBoundingClientRect(),
            card: document.querySelector('.post-card')?.getBoundingClientRect(),
            buttonHeights: Array.from(document.querySelectorAll('button')).map((button) => button.getBoundingClientRect().height),
          }));
          expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
          expect(geometry.card).toBeTruthy();
          expect(geometry.buttonHeights.length).toBeGreaterThan(0);
          expect(geometry.buttonHeights.every((height) => height >= 44)).toBe(true);
          const textContrast = await author.page.evaluate(() => {
            const parseColor = (value: string) => {
              const channels = value.match(/[\d.]+/gu)?.map(Number) ?? [];
              return channels.length >= 3 ? [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1] : null;
            };
            const luminance = (channels: number[]) => channels.slice(0, 3).map((channel) => {
              const linear = channel / 255;
              return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
            }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
            const elements = Array.from(document.querySelectorAll(
              '.posts-page h1,.posts-composer h2,.posts-field-label,.posts-counter,.post-card-content,.post-card-meta,.post-card-author > a,.post-detail-link,.ui-button',
            ));
            return elements.map((element) => {
              const chain: Element[] = [];
              for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
              let background = [250, 250, 247];
              for (const node of chain) {
                const layer = parseColor(getComputedStyle(node).backgroundColor);
                if (layer) background = background.map((channel, index) => layer[index]! * layer[3]! + channel * (1 - layer[3]!));
              }
              const foreground = parseColor(getComputedStyle(element).color);
              if (!foreground) return { selector: element.tagName, ratio: 0 };
              const foregroundLuminance = luminance(foreground);
              const backgroundLuminance = luminance(background);
              return {
                selector: element.className?.toString() || element.tagName,
                ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
                  (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
              };
            });
          });
          expect(textContrast.length).toBeGreaterThan(0);
          expect(textContrast.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
          if (path === '/bang-tin') expect(geometry.composer).toBeTruthy();
          if (viewport.width <= 390) {
            expect(geometry.card!.left).toBeGreaterThanOrEqual(0);
            expect(geometry.card!.right).toBeLessThanOrEqual(geometry.width + 1);
            if (geometry.composer) expect(geometry.composer.left).toBeGreaterThanOrEqual(0);
          }
        }
      }
      await author.page.setViewportSize({ width: 1440, height: 900 });
      await author.page.goto('/bang-tin');
      const ownCard = author.page.locator('.post-card').filter({ hasText: ownPost.content });
      const editButton = ownCard.getByRole('button', { name: 'Chỉnh sửa bài viết' });
      await editButton.click();
      const editingCard = author.page.locator('.post-card').filter({ has: author.page.locator(`#post-editor-${ownPost.id}`) });
      const editor = editingCard.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
      await expect(editor).toBeFocused();
      await editor.fill('  \n  ');
      await editingCard.getByRole('button', { name: 'Lưu thay đổi' }).click();
      const editorError = editingCard.getByRole('alert').locator('[id]');
      await expect(editorError).toHaveText('Vui lòng nhập nội dung bài viết.');
      await expect(editor).toHaveAttribute('aria-invalid', 'true');
      expect((await editor.getAttribute('aria-describedby'))?.split(/\s+/u)).toContain(await editorError.getAttribute('id'));
      await captureUiInspectionScreenshot(author.page, 'edit-validation');
      await editingCard.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(editButton).toBeFocused();

      const deleteButton = ownCard.getByRole('button', { name: 'Xóa bài viết' });
      await deleteButton.click();
      const deleteConfirmation = ownCard.getByRole('group', { name: 'Xác nhận xóa bài viết vĩnh viễn' });
      await expect(deleteConfirmation).toBeFocused();
      await expect(deleteConfirmation).toContainText('xóa vĩnh viễn');
      await captureUiInspectionScreenshot(author.page, 'delete-confirmation');
      await deleteConfirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(deleteButton).toBeFocused();

      await author.page.goto('/bang-tin');
      await author.page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await author.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      const motion = await author.page.locator('.post-card').first().evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          transitionDuration: style.transitionDuration,
          animationDuration: style.animationDuration,
          animationName: style.animationName,
          documentScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
          composerScrollBehavior: getComputedStyle(document.querySelector('textarea')!).scrollBehavior,
        };
      });
      expect(motion.animationName).toBe('none');
      expect(motion.transitionDuration.split(',').every((duration) => Number.parseFloat(duration) <= 0.001)).toBe(true);
      expect(motion.animationDuration.split(',').every((duration) => Number.parseFloat(duration) <= 0.001)).toBe(true);
      expect(motion.documentScrollBehavior).toBe('auto');
      expect(motion.composerScrollBehavior).toBe('auto');
      const submit = author.page.getByRole('button', { name: 'Đăng bài' });
      await author.page.getByLabel('Nội dung bài viết').focus();
      for (let index = 0; index < 40 && !(await submit.evaluate((element) => element === document.activeElement)); index += 1) {
        await author.page.keyboard.press('Tab');
      }
      expect(await submit.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      expect(await submit.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      expect(consoleErrors).toEqual([]);
      expect(failedRequests).toEqual([]);

      const emptyActor = await loginActor(browser, scenario, scenario.users[2]!);
      await emptyActor.page.goto('/bang-tin');
      await expect(emptyActor.page.getByText('Chưa có bài viết nào để hiển thị.')).toBeVisible();
      await captureUiInspectionScreenshot(emptyActor.page, 'empty-feed');
    });

    await test.step('PF-22 Authentication, Profile/Discovery, Friendship and protected-route compatibility', async () => {
      await author.page.goto('/ho-so');
      await author.page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click();
      await author.page.getByLabel('Tên hiển thị').fill('Weylume scenario member');
      await author.page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
      await expect(author.page.getByRole('status')).toHaveText('Hồ sơ đã được lưu.');
      await author.page.getByRole('navigation', { name: 'Điều hướng thành viên' }).getByRole('link', { name: 'Khám phá' }).click();
      await expect(author.page.getByRole('heading', { name: 'Khám phá thành viên' })).toBeVisible();
      const search = author.page.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' });
      await search.fill(`Thành viên ${member.id.slice(0, 8)}`);
      await author.page.getByRole('button', { name: /Tìm kiếm/ }).click();
      await expect(author.page.getByRole('link', { name: new RegExp(member.id.slice(0, 8), 'iu') })).toBeVisible();
      await author.page.goto(`/thanh-vien/${member.id}`);
      await expect(author.page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
      const protectedPage = await browser.newPage({ baseURL: webOrigin });
      await protectedPage.goto('/bang-tin');
      await expect(protectedPage).toHaveURL(/\/dang-nhap/u);
      await protectedPage.close();
      const authSession = await apiCall(author, 'GET', '/auth/session');
      expect(authSession.status()).toBe(200);

      const requester = await loginActor(browser, scenario, scenario.users[2]!);
      expect((await apiCall(requester, 'GET', `/posts/${ownPost.id}`)).status()).toBe(404);
      expect((await apiCall(requester, 'GET', `/posts/${memberPost.id}`)).status()).toBe(200);
      const intent = await requestFriendship(scenario, requester, author);
      const rejected = await rejectFriendship(scenario, author, intent);
      expect(rejected.request.status).toBe('REJECTED');
      expect(rejected.relationship.state).toBe('none');
      expect((await apiCall(requester, 'GET', `/posts/${ownPost.id}`)).status()).toBe(404);
      expect((await apiCall(requester, 'GET', `/posts/${memberPost.id}`)).status()).toBe(200);
      const rejectedProfileIds = await readMemberProfileIds(requester, member.id);
      expect(rejectedProfileIds).toContain(memberPost.id);
      expect(rejectedProfileIds).not.toContain(ownPost.id);
      const rejectedFeed = await apiCall(requester, 'GET', '/feed');
      expect(rejectedFeed.status()).toBe(200);
      expect((await rejectedFeed.json()).items.map((item: { id: string }) => item.id)).not.toContain(memberPost.id);
      const ready = await fetch(`${apiOrigin}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ready', database: 'isn-test', schemaVersion: 5 });
    });

    await test.step('PF-23 exact fixture cleanup and preserved baseline', async () => {
      // The enclosing finally performs owned cleanup and verifies the data fingerprint.
      expect(scenario.manifest.baseline.dataFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    });
  } finally {
    await cleanupPostsScenario(scenario);
  }
});

async function loginActors(scenario: Scenario, browser: Browser, users: Scenario['users']): Promise<Actor[]> {
  const actors: Actor[] = [];
  for (const user of users) actors.push(await loginActor(browser, scenario, user));
  return actors;
}

async function loginActor(browser: Browser, scenario: Scenario, user: Scenario['users'][number]): Promise<Actor> {
  const context = await browser.newContext({ baseURL: webOrigin });
  const page = await context.newPage();
  await recordScenarioContext(scenario, context);
  await page.goto('/ho-so');
  await expect(page).toHaveURL(/\/dang-nhap\?returnTo=%2Fho-so/u);
  await page.getByLabel('Địa chỉ email').fill(user.email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(user.password);
  const login = waitForResponse(page, 'POST', '/api/auth/login');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(/\/ho-so$/u);
  await expect(page.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
  const loginBody = await login.then((response) => response.json());
  const csrfToken = loginBody.csrfToken as string;
  await recordScenarioAuthState(scenario, user.id);
  return { ...user, context, page, csrfToken };
}

async function createPostFromComposer(
  scenario: Scenario,
  actor: Actor,
  input: { content: string; visibility?: 'friends' | 'members' },
) {
  const marker = extractFixtureMarker(input.content);
  const visibility = input.visibility ?? 'friends';
  await reserveScenarioPost(scenario, { authorId: actor.id, marker, visibility });
  await actor.page.goto('/bang-tin');
  await actor.page.getByLabel('Nội dung bài viết').fill(input.content);
  if (input.visibility !== undefined) await actor.page.getByLabel('Ai có thể xem?').selectOption(input.visibility);
  const responsePromise = waitForResponse(actor.page, 'POST', '/api/posts');
  await actor.page.getByRole('button', { name: 'Đăng bài' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const post = (await response.json()).post;
  await recordScenarioPost(scenario, { authorId: actor.id, marker, postId: post.id });
  await expect(actor.page.getByText('Bài viết đã được đăng.', { exact: true })).toBeVisible();
  await expect(actor.page.getByText(post.content, { exact: true }).first()).toBeVisible();
  await expect(actor.page.getByLabel('Nội dung bài viết')).toHaveValue('');
  return post as Record<string, any>;
}

async function requestFriendship(scenario: Scenario, sender: Actor, recipient: Actor) {
  const intentId = await reserveScenarioFriendship(scenario, { senderId: sender.id, recipientId: recipient.id });
  await sender.page.goto(`/thanh-vien/${recipient.id}`);
  const responsePromise = waitForResponse(sender.page, 'POST', '/api/friendships/requests');
  await sender.page.getByRole('button', { name: 'Kết bạn' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const result = await response.json();
  await recordScenarioFriendshipCreated(scenario, intentId, result.request.id, result.request.createdAt);
  return { intentId, request: result.request };
}

async function acceptFriendship(scenario: Scenario, recipient: Actor, intent: { intentId: string; request: { id: string } }) {
  await recipient.page.goto('/ban-be/loi-moi?direction=received');
  const responsePromise = waitForResponse(recipient.page, 'POST', `/api/friendships/requests/${intent.request.id}/accept`);
  await recipient.page.getByRole('button', { name: 'Chấp nhận' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const result = await response.json();
  await recordScenarioFriendshipResolved(scenario, intent.intentId, {
    requestStatus: 'ACCEPTED',
    friendshipId: result.relationship.friendshipId,
    friendsSince: result.relationship.friendsSince,
    resolvedAt: new Date().toISOString(),
  });
  return result;
}

async function rejectFriendship(scenario: Scenario, recipient: Actor, intent: { intentId: string; request: { id: string } }) {
  await recipient.page.goto('/ban-be/loi-moi?direction=received');
  const responsePromise = waitForResponse(recipient.page, 'POST', `/api/friendships/requests/${intent.request.id}/reject`);
  await recipient.page.getByRole('button', { name: 'Từ chối' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const result = await response.json();
  await recordScenarioFriendshipResolved(scenario, intent.intentId, {
    requestStatus: result.request.status,
    friendshipId: result.relationship.friendshipId,
    friendsSince: result.relationship.friendsSince,
    resolvedAt: result.request.resolvedAt,
  });
  return result;
}

async function apiCall(actor: Actor, method: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  return actor.context.request.fetch(`${webOrigin}/api${path}`, {
    method,
    headers: { Origin: webOrigin, 'X-CSRF-Token': actor.csrfToken, ...headers },
    ...(data === undefined ? {} : { data }),
    timeout: requestTimeout,
  });
}

function waitForResponse(page: Page, method: string, path: string) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === path &&
    response.request().method() === method, { timeout: requestTimeout });
}

function createControlledFeedDelivery(): ControlledFeedDelivery {
  let arrive!: () => void;
  let settle!: () => void;
  let release!: () => void;
  const arrival = new Promise<void>((resolve) => { arrive = resolve; });
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    arrival,
    settled,
    gate,
    arrive,
    settle,
    release,
    started: false,
    hasPost: false,
    hasDeletedPost: false,
    delivered: false,
  };
}

async function loadAllPostPages(page: Page, apiPath: string) {
  const loadMore = page.getByRole('button', { name: 'Tải thêm bài viết', exact: true });
  while (await loadMore.count()) {
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === `/api${apiPath}` && url.searchParams.has('cursor');
    }, { timeout: requestTimeout });
    await loadMore.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    if (body.pagination.hasMore) await expect(loadMore).toBeEnabled();
    else await expect(loadMore).toHaveCount(0);
  }
}

async function readMemberProfileIds(actor: Actor, memberId: string) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams({ limit: '2' });
    if (cursor) query.set('cursor', cursor);
    const response = await apiCall(actor, 'GET', `/users/${memberId}/posts?${query}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    ids.push(...body.items.map((item: { id: string }) => item.id));
    if (!body.pagination.hasMore) {
      expect(new Set(ids).size).toBe(ids.length);
      return ids;
    }
    expect(typeof body.pagination.nextCursor).toBe('string');
    cursor = body.pagination.nextCursor;
  }
  throw new Error('Member profile cursor traversal did not terminate.');
}

async function readFirstTwoMemberProfileIds(actor: Actor, memberId: string) {
  const first = await apiCall(actor, 'GET', `/users/${memberId}/posts?limit=1`);
  expect(first.status()).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.pagination.hasMore).toBe(true);
  expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));
  const second = await apiCall(actor, 'GET',
    `/users/${memberId}/posts?limit=1&cursor=${encodeURIComponent(firstBody.pagination.nextCursor)}`);
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.items).toHaveLength(1);
  return [firstBody.items[0].id, secondBody.items[0].id] as string[];
}

async function overlapRequests(
  pages: Page[],
  method: string,
  pathname: string,
  actions: Array<() => Promise<void>>,
  options: { methods?: string[] } = {},
) {
  let arrivals = 0;
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const bothArrived = new Promise<void>((resolve) => { arrived = resolve; });
  await Promise.all(pages.map((page, index) => page.route('**/api/posts/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const expectedMethod = options.methods?.[index] ?? method;
    if (url.pathname === pathname && request.method() === expectedMethod) {
      arrivals += 1;
      if (arrivals === actions.length) arrived();
      await gate;
    }
    await route.continue();
  })));
  const responses = pages.map((page, index) => page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname && response.request().method() === (options.methods?.[index] ?? method),
  { timeout: requestTimeout }));
  try {
    await Promise.all(actions.map((action) => action()));
    await bothArrived;
    expect(arrivals).toBe(actions.length);
    release();
    const result = await Promise.all(responses);
    return { statuses: result.map((response) => response.status()), responses: result, arrivalCount: arrivals };
  } finally {
    release();
    for (const page of pages) await page.unroute('**/api/posts/**');
  }
}

async function countPosts(scenario: Scenario, authorId: string) {
  const result = await scenario.session.run('MATCH (post:Post {authorId:$authorId}) RETURN count(post) AS count', { authorId });
  return asNumber(result.records[0]?.get('count'));
}

async function countPostById(scenario: Scenario, postId: string) {
  const result = await scenario.session.run('MATCH (post:Post {id:$postId}) RETURN count(post) AS count', { postId });
  return asNumber(result.records[0]?.get('count'));
}

async function readPostSnapshot(scenario: Scenario, authorId: string, postId: string) {
  const result = await scenario.session.run(
    `MATCH (author:User {id:$authorId})
     OPTIONAL MATCH (author)-[edge:AUTHORED]->(post:Post {id:$postId})
     RETURN count(post) AS postCount,count(edge) AS authorshipCount,head(collect(post.content)) AS content,
            head(collect(post.version)) AS version,head(collect(post.visibility)) AS visibility`,
    { authorId, postId },
  );
  expect(result.records).toHaveLength(1);
  const record = result.records[0];
  if (!record) throw new Error('The Posts persistence snapshot is missing.');
  const version = record.get('version');
  return {
    postCount: asNumber(record.get('postCount')),
    authorshipCount: asNumber(record.get('authorshipCount')),
    content: record.get('content'),
    version: version === null ? null : asNumber(version),
    visibility: record.get('visibility'),
  };
}

async function countPostByMarker(scenario: Scenario, authorId: string, marker: string) {
  const result = await scenario.session.run(
    'MATCH (post:Post {authorId:$authorId}) WHERE post.content CONTAINS $marker RETURN count(post) AS count',
    { authorId, marker },
  );
  return asNumber(result.records[0]?.get('count'));
}

async function readFeedOracle(scenario: Scenario, viewerId: string) {
  const friendIds = scenario.manifest.fixtures.friendships
    .filter((pair) => pair.requestStatus === 'ACCEPTED' && pair.friendshipId !== null)
    .flatMap((pair) => pair.lowUserId === viewerId ? [pair.highUserId] : pair.highUserId === viewerId ? [pair.lowUserId] : []);
  const result = await scenario.session.run(
    `MATCH (post:Post)
     WHERE post.authorId IN $eligibleAuthorIds AND
           (post.authorId = $viewerId OR post.visibility IN ['friends','members'])
     RETURN post.id AS id,post.content AS content,toString(post.createdAt) AS createdAt
     ORDER BY post.createdAt DESC,post.id DESC`,
    { viewerId, eligibleAuthorIds: [viewerId, ...friendIds] },
  );
  return result.records.map((record) => ({
    id: String(record.get('id')),
    content: String(record.get('content')),
    createdAt: String(record.get('createdAt')),
  }));
}

async function readMemberPostsOracle(scenario: Scenario, memberId: string) {
  const result = await scenario.session.run(
    `MATCH (post:Post {authorId:$memberId})
     RETURN post.id AS id,post.content AS content,post.visibility AS visibility
     ORDER BY post.createdAt DESC,post.id DESC`,
    { memberId },
  );
  return result.records.map((record) => ({
    id: String(record.get('id')),
    content: String(record.get('content')),
    visibility: String(record.get('visibility')) as 'friends' | 'members',
  }));
}

async function readVisibleMemberProfileOracle(scenario: Scenario, viewerId: string, memberId: string) {
  const acceptedFriend = scenario.manifest.fixtures.friendships.some((pair) =>
    ((pair.lowUserId === viewerId && pair.highUserId === memberId) ||
      (pair.highUserId === viewerId && pair.lowUserId === memberId)) &&
    pair.requestStatus === 'ACCEPTED' && pair.friendshipId !== null);
  const posts = await readMemberPostsOracle(scenario, memberId);
  return posts
    .filter((post) => viewerId === memberId || post.visibility === 'members' || acceptedFriend)
    .map((post) => post.id);
}

async function captureUiInspectionScreenshot(page: Page, name: string) {
  const gateFile = process.env.ISN_POSTS_SCENARIO_GATE_FILE;
  if (!gateFile) throw new Error('UI inspection screenshots require the guarded Posts invocation.');
  const runId = basename(gateFile, '.json');
  if (!/^[0-9a-f-]{36}$/iu.test(runId)) throw new Error('UI inspection screenshot run ID is invalid.');
  const directory = resolve(process.cwd(), '.artifacts/playwright/posts', runId, 'ui-inspection');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' });
}

function markerFor(prefix: string): string {
  return `posts-fixture-${prefix}-${randomUUID().replaceAll('-', '')}`;
}

function extractFixtureMarker(content: string): string {
  const match = content.match(/posts-fixture-[a-z0-9-]{6,64}/u);
  if (!match) throw new Error('Each scenario-created Post must include its reserved ownership marker.');
  return match[0];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number((value as { toNumber?: () => number } | undefined)?.toNumber?.());
}
