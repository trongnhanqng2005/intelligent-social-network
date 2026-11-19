import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import neo4j, { type Driver } from 'neo4j-driver';
import { expect, test, type APIResponse, type BrowserContext, type Page, type Route } from '@playwright/test';
import acceptanceSupport from '../../fixtures/friendships/acceptance-support.cjs';
const {
  assertTestEnvironment,
  captureBaseline,
  cleanupRun,
  recordRunFriendship,
  recordRunRequest,
  refreshOwnedAuthRecords,
  registerOwnedFixture,
  reserveRunFixture,
  reserveRunPair,
  verifyCurrentV4,
  writeRunManifest,
  saveRunManifest,
} = acceptanceSupport;

const apiOrigin = 'http://127.0.0.1:3311';
const webOrigin = 'http://127.0.0.1:5181';
const password = 'Friendship scenario password 2026!';
const driver: Driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME!, process.env.NEO4J_TEST_PASSWORD!),
);

type Actor = {
  email: string;
  userId: string;
  displayName: string;
  context: BrowserContext;
  page: Page;
  csrfToken: string;
};

let initialBaseline: Awaited<ReturnType<typeof captureBaseline>>;

test.beforeAll(async () => {
  assertTestEnvironment();
  await driver.verifyConnectivity();
  const session = driver.session({ database: 'isn-test' });
  try {
    await verifyCurrentV4(session);
    initialBaseline = await captureBaseline(session);
  } finally {
    await session.close();
  }
});

test.afterAll(async () => {
  await driver.close();
});

test('FS-01–04 and FS-06–08 real React/API/Neo4j acceptance, reload, recovery and owned cleanup', async ({
  page: ownerPage,
  context: ownerContext,
  browser,
}) => {
  test.setTimeout(300_000);
  const { path: manifestPath, manifest } = await writeRunManifest(initialBaseline);
  const contexts: BrowserContext[] = [ownerContext];
  const actors = new Map<string, Actor>();
  const fixtureEmails = ['A', 'B', 'C', 'D', 'E'].map(() => `profile-${randomUUID()}@example.invalid`);
  let cleanupSucceeded = false;
  let scenarioFailure: unknown;

  for (const email of fixtureEmails) await reserveRunFixture(manifestPath, manifest, email);

  try {
    for (let index = 0; index < fixtureEmails.length; index += 1) {
      const email = fixtureEmails[index];
      assert.ok(email);
      const context = index === 0 ? ownerContext : await browser.newContext({
        baseURL: webOrigin,
        viewport: { width: 1440, height: 900 },
      });
      if (index > 0) contexts.push(context);
      const actorPage = index === 0 ? ownerPage : await context.newPage();
      const actor = await registerAndLogin(actorPage, context, email, manifestPath, manifest);
      actors.set(String.fromCharCode(65 + index), actor);
    }

    const alice = actors.get('A');
    const bob = actors.get('B');
    const cara = actors.get('C');
    const dee = actors.get('D');
    const erin = actors.get('E');
    assert.ok(alice && bob && cara && dee && erin);
    for (const [sender, recipient] of [
      [alice, bob], [alice, cara], [alice, dee], [alice, erin],
      [dee, cara], [dee, bob], [erin, cara], [erin, bob], [erin, dee],
    ]) {
      await reserveRunPair(manifestPath, manifest, sender.userId, recipient.userId);
    }

    // FS-01: discover B through the actual directory UI, then send and reload both views.
    await discoverMember(alice.page, bob);
    await expect(alice.page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
    await expect(alice.page.getByRole('button', { name: 'Kết bạn' })).toBeVisible();
    const sendToBob = waitForFriendshipResponse(alice.page, 'POST', '/friendships/requests');
    await alice.page.getByRole('button', { name: 'Kết bạn' }).click();
    const sendResponse = await sendToBob;
    expect(sendResponse.status()).toBe(201);
    const firstRequest = await sendResponse.json();
    expect(firstRequest.relationship.state).toBe('outgoing_pending');
    await recordRunRequest(manifestPath, manifest, pairKey(alice.userId, bob.userId), firstRequest.request.id);
    await expect(alice.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();
    await alice.page.reload();
    await expect(alice.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();

    await bob.page.goto('/ban-be/loi-moi?direction=received');
    await expect(bob.page.getByRole('heading', { name: 'Lời mời kết bạn' })).toBeVisible();
    await expect(bob.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await bob.page.reload();
    await expect(bob.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await expectPair(driver, alice.userId, bob.userId, {
      status: 'PENDING', requestId: firstRequest.request.id, friendshipId: null, edges: 0,
    });

    // FS-02: B accepts in the real incoming-request UI; both lists survive reload.
    const acceptResponsePromise = waitForFriendshipResponse(bob.page, 'POST', `/requests/${firstRequest.request.id}/accept`);
    await bob.page.getByRole('button', { name: 'Chấp nhận' }).click();
    const firstAcceptResponse = await acceptResponsePromise;
    expect(firstAcceptResponse.status()).toBe(200);
    const firstAcceptance = await firstAcceptResponse.json();
    const firstFriendshipId = firstAcceptance.relationship.friendshipId as string;
    await recordRunFriendship(manifestPath, manifest, pairKey(alice.userId, bob.userId), firstFriendshipId);
    await expect(bob.page.getByText(`Bạn và ${alice.displayName} đã trở thành bạn bè.`)).toBeVisible();
    await bob.page.goto('/ban-be');
    await expect(bob.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await bob.page.reload();
    await expect(bob.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await expectPair(driver, alice.userId, bob.userId, {
      status: 'ACCEPTED', requestId: firstRequest.request.id, friendshipId: firstFriendshipId, edges: 1,
    });

    // FS-06/08: a real second-session acceptance makes A's already loaded cancel action stale.
    await expect(alice.page.getByRole('button', { name: 'Hủy lời mời' })).toBeVisible();
    const staleCancel = waitForFriendshipResponse(alice.page, 'POST', `/requests/${firstRequest.request.id}/cancel`);
    await alice.page.getByRole('button', { name: 'Hủy lời mời' }).click();
    const conflict = await staleCancel;
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe('FRIENDSHIP_STATE_CONFLICT');
    await expect(alice.page.getByRole('alert')).toBeVisible();
    await expect(alice.page.getByText('Hai bạn là bạn bè.')).toBeVisible();
    await alice.page.goto('/ban-be');
    await expect(alice.page.getByRole('link', { name: bob.displayName, exact: true })).toBeVisible();
    await alice.page.reload();
    await expect(alice.page.getByRole('link', { name: bob.displayName, exact: true })).toBeVisible();

    // FS-04: cancel the inline confirmation without issuing DELETE, then unfriend.
    let deleteCount = 0;
    const countDelete = (request: { method(): string; url(): string }) => {
      if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/friendships/${firstFriendshipId}`) deleteCount += 1;
    };
    alice.page.on('request', countDelete);
    const unfriendTrigger = alice.page.getByRole('button', { name: 'Hủy kết bạn' });
    await unfriendTrigger.click();
    const confirmation = alice.page.getByRole('group', { name: 'Xác nhận hủy kết bạn' });
    await expect(confirmation).toBeFocused();
    await alice.page.getByRole('button', { name: 'Giữ kết bạn' }).click();
    await expect(unfriendTrigger).toBeFocused();
    expect(deleteCount).toBe(0);
    await alice.page.getByRole('button', { name: 'Hủy kết bạn' }).click();
    await expect(alice.page.getByRole('group', { name: 'Xác nhận hủy kết bạn' })).toBeFocused();
    const unfriendResponsePromise = waitForFriendshipResponse(alice.page, 'DELETE', `/friendships/${firstFriendshipId}`);
    await alice.page.getByRole('button', { name: 'Xác nhận hủy' }).click();
    const unfriendResponse = await unfriendResponsePromise;
    expect(unfriendResponse.status()).toBe(204);
    alice.page.off('request', countDelete);
    await expectPair(driver, alice.userId, bob.userId, {
      status: 'ACCEPTED', requestId: firstRequest.request.id, friendshipId: null, edges: 0,
    });
    await alice.page.goto(`/thanh-vien/${bob.userId}`);
    await expect(alice.page.getByRole('button', { name: 'Kết bạn' })).toBeVisible();
    await alice.page.reload();
    await expect(alice.page.getByRole('button', { name: 'Kết bạn' })).toBeVisible();
    await alice.page.goto('/ban-be');
    await expect(alice.page.getByRole('heading', { name: 'Bạn chưa có bạn bè.' })).toBeVisible();
    await alice.page.reload();
    await expect(alice.page.getByRole('heading', { name: 'Bạn chưa có bạn bè.' })).toBeVisible();
    await bob.page.goto('/ban-be');
    await expect(bob.page.getByRole('heading', { name: 'Bạn chưa có bạn bè.' })).toBeVisible();
    await bob.page.reload();
    await expect(bob.page.getByRole('heading', { name: 'Bạn chưa có bạn bè.' })).toBeVisible();
    await bob.page.goto(`/thanh-vien/${alice.userId}`);
    await expect(bob.page.getByRole('button', { name: 'Kết bạn' })).toBeVisible();

    await alice.page.goto(`/thanh-vien/${bob.userId}`);
    await expect(alice.page.getByRole('button', { name: 'Kết bạn' })).toBeVisible();
    const secondSendToBob = waitForFriendshipResponse(alice.page, 'POST', '/friendships/requests');
    await alice.page.getByRole('button', { name: 'Kết bạn' }).click();
    const secondRequestResponse = await secondSendToBob;
    expect(secondRequestResponse.status()).toBe(201);
    const secondRequest = await secondRequestResponse.json();
    expect(secondRequest.request.id).not.toBe(firstRequest.request.id);
    await recordRunRequest(manifestPath, manifest, pairKey(alice.userId, bob.userId), secondRequest.request.id);
    await bob.page.goto('/ban-be/loi-moi?direction=received');
    const secondAcceptPromise = waitForFriendshipResponse(bob.page, 'POST', `/requests/${secondRequest.request.id}/accept`);
    await bob.page.getByRole('button', { name: 'Chấp nhận' }).click();
    const secondAcceptanceResponse = await secondAcceptPromise;
    expect(secondAcceptanceResponse.status()).toBe(200);
    const secondAcceptance = await secondAcceptanceResponse.json();
    const secondFriendshipId = secondAcceptance.relationship.friendshipId as string;
    expect(secondFriendshipId).not.toBe(firstFriendshipId);
    await recordRunFriendship(manifestPath, manifest, pairKey(alice.userId, bob.userId), secondFriendshipId);
    const staleDelete = await apiRequest(alice, 'DELETE', `/friendships/${firstFriendshipId}`);
    expect(staleDelete.status()).toBe(204);
    await expectPair(driver, alice.userId, bob.userId, {
      status: 'ACCEPTED', requestId: secondRequest.request.id, friendshipId: secondFriendshipId, edges: 1,
    });

    // FS-03: reject, repeat the terminal action, reject a contradictory action, cancel, and re-request.
    const firstSendToCara = await sendFromDiscovery(alice, cara, manifestPath, manifest);
    await cara.page.goto('/ban-be/loi-moi?direction=received');
    await expect(cara.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    const rejectPromise = waitForFriendshipResponse(cara.page, 'POST', `/requests/${firstSendToCara.request.id}/reject`);
    await cara.page.getByRole('button', { name: 'Từ chối' }).click();
    const rejectResponse = await rejectPromise;
    expect(rejectResponse.status()).toBe(200);
    const rejected = await rejectResponse.json();
    const rejectRetry = await apiRequest(cara, 'POST', `/friendships/requests/${firstSendToCara.request.id}/reject`, {});
    expect(rejectRetry.status()).toBe(200);
    expect((await rejectRetry.json()).request.id).toBe(firstSendToCara.request.id);
    const rejectContradiction = await apiRequest(alice, 'POST', `/friendships/requests/${firstSendToCara.request.id}/cancel`, {});
    expect(rejectContradiction.status()).toBe(409);
    expect((await rejectContradiction.json()).error.code).toBe('FRIENDSHIP_STATE_CONFLICT');
    expect(rejected.relationship.friendshipId).toBeNull();
    await expectPair(driver, alice.userId, cara.userId, {
      status: 'REJECTED', requestId: firstSendToCara.request.id, friendshipId: null, edges: 0,
    });

    const secondSendToCara = await sendFromDiscovery(alice, cara, manifestPath, manifest);
    expect(secondSendToCara.request.id).not.toBe(firstSendToCara.request.id);
    await expect(alice.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();
    const cancelPromise = waitForFriendshipResponse(alice.page, 'POST', `/requests/${secondSendToCara.request.id}/cancel`);
    await alice.page.getByRole('button', { name: 'Hủy lời mời' }).click();
    const cancelResponse = await cancelPromise;
    expect(cancelResponse.status()).toBe(200);
    const cancelled = await cancelResponse.json();
    const cancelRetry = await apiRequest(alice, 'POST', `/friendships/requests/${secondSendToCara.request.id}/cancel`, {});
    expect(cancelRetry.status()).toBe(200);
    expect((await cancelRetry.json()).request.id).toBe(secondSendToCara.request.id);
    const cancelledContradiction = await apiRequest(cara, 'POST', `/friendships/requests/${secondSendToCara.request.id}/accept`, {});
    expect(cancelledContradiction.status()).toBe(409);
    expect((await cancelledContradiction.json()).error.code).toBe('FRIENDSHIP_STATE_CONFLICT');
    expect(cancelled.relationship.friendshipId).toBeNull();
    await expectPair(driver, alice.userId, cara.userId, {
      status: 'CANCELLED', requestId: secondSendToCara.request.id, friendshipId: null, edges: 0,
    });

    const finalSendToCara = await sendFromDiscovery(alice, cara, manifestPath, manifest);
    expect(finalSendToCara.request.id).not.toBe(secondSendToCara.request.id);
    await cara.page.goto('/ban-be/loi-moi?direction=received');
    const finalAcceptPromise = waitForFriendshipResponse(cara.page, 'POST', `/requests/${finalSendToCara.request.id}/accept`);
    await cara.page.getByRole('button', { name: 'Chấp nhận' }).click();
    const finalAcceptResponse = await finalAcceptPromise;
    expect(finalAcceptResponse.status()).toBe(200);
    const finalAcceptance = await finalAcceptResponse.json();
    const caraFriendshipId = finalAcceptance.relationship.friendshipId as string;
    await recordRunFriendship(manifestPath, manifest, pairKey(alice.userId, cara.userId), caraFriendshipId);
    await alice.page.goto('/ban-be');
    await expect(alice.page.getByRole('link', { name: cara.displayName, exact: true })).toBeVisible();
    await alice.page.reload();
    await expect(alice.page.getByRole('link', { name: cara.displayName, exact: true })).toBeVisible();
    await cara.page.goto('/ban-be');
    await expect(cara.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await cara.page.reload();
    await expect(cara.page.getByRole('link', { name: alice.displayName, exact: true })).toBeVisible();
    await expectPair(driver, alice.userId, cara.userId, {
      status: 'ACCEPTED', requestId: finalSendToCara.request.id, friendshipId: caraFriendshipId, edges: 1,
    });

    // FS-06: anonymous/authz/privacy checks; a nonparticipant cannot inspect or remove A-B.
    const anonymous = await browser.newContext({ baseURL: webOrigin });
    try {
      const anonymousList = await anonymous.request.get(`${webOrigin}/api/friendships`);
      expect(anonymousList.status()).toBe(401);
      expect(anonymousList.headers()['cache-control']).toContain('no-store');
    } finally {
      await anonymous.close();
    }
    const aToBBeforePrivacy = await readPair(driver, alice.userId, bob.userId);
    const hiddenAction = await apiRequest(erin, 'POST', `/friendships/requests/${secondRequest.request.id}/accept`, {});
    expect(hiddenAction.status()).toBe(404);
    expect((await hiddenAction.json()).error.code).toBe('REQUEST_NOT_FOUND');
    const nonparticipantDelete = await apiRequest(erin, 'DELETE', `/friendships/${secondFriendshipId}`);
    expect(nonparticipantDelete.status()).toBe(204);
    const erinRequests = await erin.context.request.get(`${webOrigin}/api/friendships/requests?direction=received`);
    expect(erinRequests.status()).toBe(200);
    expect((await erinRequests.json()).items).toEqual([]);
    expect(await readPair(driver, alice.userId, bob.userId)).toEqual(aToBBeforePrivacy);
    const publicFriends = await alice.context.request.get(`${webOrigin}/api/friendships`);
    const publicFriendsBody = await publicFriends.json();
    expect(Object.keys(publicFriendsBody.items[0]).sort()).toEqual(['friendsSince', 'friendshipId', 'member']);
    expect(Object.keys(publicFriendsBody.items[0].member).sort()).toEqual(['bio', 'displayName', 'id', 'location']);
    expect(JSON.stringify(publicFriendsBody)).not.toMatch(/email|password|session|event|neo4j|elementId|internalId/iu);
    const rejectedOrigin = await apiRequest(erin, 'POST', '/friendships/requests', { recipientId: alice.userId }, 'https://not-weylume.invalid');
    expect(rejectedOrigin.status()).toBe(403);
    expect(rejectedOrigin.headers()['cache-control']).toContain('no-store');

    // FS-07: use an intercepted request rewrite only to ask the real API for limit=1.
    await withLimitOne(alice.page, async () => {
      await alice.page.goto('/ban-be');
      const list = alice.page.getByRole('list', { name: 'Danh sách bạn bè' });
      await expect(list.locator('a')).toHaveCount(1);
      const firstFriendName = await list.locator('a').first().textContent();
      await alice.page.getByRole('button', { name: 'Trang tiếp' }).click();
      await expect(list.locator('a')).toHaveCount(1);
      await expect(list.locator('a').first()).not.toHaveText(firstFriendName ?? '');
      await alice.page.getByRole('button', { name: 'Trang trước' }).click();
      await expect(list.locator('a').first()).toHaveText(firstFriendName ?? '');
      await list.locator('a').first().click();
      await expect(alice.page).toHaveURL(/\/thanh-vien\//u);
      await alice.page.goBack();
      await expect(alice.page).toHaveURL(/\/ban-be$/u);
      await alice.page.goForward();
      await expect(alice.page).toHaveURL(/\/thanh-vien\//u);
      await alice.page.goBack();
    });

    // Make received/sent cursors real, API-issued pages over the minimal three-member pairs.
    const deeToCara = await sendFromDiscovery(dee, cara, manifestPath, manifest);
    const deeToBob = await sendFromDiscovery(dee, bob, manifestPath, manifest);
    const erinToCara = await sendFromDiscovery(erin, cara, manifestPath, manifest);
    const erinToBob = await sendFromDiscovery(erin, bob, manifestPath, manifest);
    expect(deeToCara.status).toBe(201);
    expect(deeToBob.status).toBe(201);
    expect(erinToCara.status).toBe(201);
    expect(erinToBob.status).toBe(201);

    await withLimitOne(cara.page, async () => {
      await cara.page.goto('/ban-be/loi-moi?direction=received');
      const received = cara.page.getByRole('list', { name: 'Lời mời đã nhận' });
      await expect(received.locator('li')).toHaveCount(1);
      const firstSender = await received.locator('a').first().textContent();
      await cara.page.getByRole('button', { name: 'Trang tiếp' }).click();
      await expect(received.locator('li')).toHaveCount(1);
      await expect(received.locator('a').first()).not.toHaveText(firstSender ?? '');
      await cara.page.getByRole('button', { name: 'Trang trước' }).click();
      await expect(received.locator('a').first()).toHaveText(firstSender ?? '');
    });
    await withLimitOne(erin.page, async () => {
      await erin.page.goto('/ban-be/loi-moi?direction=sent');
      const sent = erin.page.getByRole('list', { name: 'Lời mời đã gửi' });
      await expect(sent.locator('li')).toHaveCount(1);
      const firstRecipient = await sent.locator('a').first().textContent();
      await erin.page.getByRole('button', { name: 'Trang tiếp' }).click();
      await expect(sent.locator('li')).toHaveCount(1);
      await expect(sent.locator('a').first()).not.toHaveText(firstRecipient ?? '');
      await erin.page.getByRole('button', { name: 'Trang trước' }).click();
    });

    // FS-08 fault classifications: a client-held request, a real committed write with response loss,
    // one simulated 503, and one delayed genuine read that becomes stale after SPA navigation.
    await alice.page.goto(`/thanh-vien/${erin.userId}`);
    let reportHeldRequest!: () => void;
    let releaseHeldRequest!: () => void;
    const heldStarted = new Promise<void>((resolve) => { reportHeldRequest = resolve; });
    const heldGate = new Promise<void>((resolve) => { releaseHeldRequest = resolve; });
    const holdMutation = async (route: Route) => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/friendships/requests') {
        reportHeldRequest();
        await heldGate;
      }
      await route.continue();
    };
    await alice.page.route('**/api/friendships/requests', holdMutation);
    const heldResponsePromise = waitForFriendshipResponse(alice.page, 'POST', '/friendships/requests');
    try {
      await alice.page.getByRole('button', { name: 'Kết bạn' }).click();
      await heldStarted;
      await expect(alice.page.getByRole('button', { name: 'Đang gửi lời mời…' })).toBeDisabled();
      releaseHeldRequest();
      const heldResponse = await heldResponsePromise;
      expect(heldResponse.status()).toBe(201);
      const heldRequest = await heldResponse.json();
      await recordRunRequest(manifestPath, manifest, pairKey(alice.userId, erin.userId), heldRequest.request.id);
      await expect(alice.page.getByText('Đã gửi lời mời kết bạn.', { exact: true })).toBeVisible();
    } finally {
      releaseHeldRequest();
      await alice.page.unroute('**/api/friendships/requests', holdMutation);
    }

    await erin.page.goto(`/thanh-vien/${dee.userId}`);
    let suppressedRequestId = '';
    const suppressCommittedResponse = async (route: Route) => {
      if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== '/api/friendships/requests') {
        await route.continue();
        return;
      }
      const realResponse = await route.fetch();
      const body = await realResponse.json();
      expect(realResponse.status()).toBe(201);
      suppressedRequestId = body.request.id;
      await recordRunRequest(manifestPath, manifest, pairKey(erin.userId, dee.userId), suppressedRequestId);
      await route.abort('failed');
    };
    await erin.page.route('**/api/friendships/requests', suppressCommittedResponse);
    try {
      await erin.page.getByRole('button', { name: 'Kết bạn' }).click();
      await expect(erin.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();
      await expect(erin.page.getByRole('alert')).toBeVisible();
      expect(suppressedRequestId).toMatch(/^[0-9a-f-]{36}$/iu);
    } finally {
      await erin.page.unroute('**/api/friendships/requests', suppressCommittedResponse);
    }
    await expectPair(driver, erin.userId, dee.userId, {
      status: 'PENDING', requestId: suppressedRequestId, friendshipId: null, edges: 0,
    });

    const simulated503 = async (route: Route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Acceptance-only simulated HTTP 503.' } }),
      });
    };
    await erin.page.route(`**/api/friendships/status/${dee.userId}`, simulated503);
    try {
      await erin.page.goto(`/thanh-vien/${dee.userId}`);
      await expect(erin.page.getByRole('alert')).toContainText('Acceptance-only simulated HTTP 503.');
      await expect(erin.page.getByRole('button', { name: 'Kết bạn' })).toHaveCount(0);
    } finally {
      await erin.page.unroute(`**/api/friendships/status/${dee.userId}`, simulated503);
    }
    await erin.page.getByRole('button', { name: 'Thử tải lại' }).click();
    await expect(erin.page.getByRole('button', { name: 'Hủy lời mời' })).toBeVisible();

    let reportDelayedResponse!: () => void;
    let releaseDelayedResponse!: () => void;
    let routeFinished!: () => void;
    const delayedReady = new Promise<void>((resolve) => { reportDelayedResponse = resolve; });
    const delayedGate = new Promise<void>((resolve) => { releaseDelayedResponse = resolve; });
    const delayedFinished = new Promise<void>((resolve) => { routeFinished = resolve; });
    const delayRealStatus = async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== `/api/friendships/status/${bob.userId}`) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      reportDelayedResponse();
      try {
        await delayedGate;
        await route.fulfill({ response });
      } catch {
        // React may abort the stale fetch on navigation; the real API response was already obtained.
      } finally {
        routeFinished();
      }
    };
    await alice.page.route('**/api/friendships/status/**', delayRealStatus);
    try {
      await alice.page.goto(`/thanh-vien/${bob.userId}`);
      await delayedReady;
      await alice.page.getByRole('link', { name: 'Quay lại khám phá' }).click();
      await discoverMember(alice.page, erin);
      await expect(alice.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();
      releaseDelayedResponse();
      await delayedFinished;
      await expect(alice.page.getByText('Đã gửi lời mời kết bạn', { exact: true })).toBeVisible();
      await expect(alice.page.getByText('Hai bạn là bạn bè.')).toHaveCount(0);
    } finally {
      releaseDelayedResponse();
      await alice.page.unroute('**/api/friendships/status/**', delayRealStatus);
    }

    // UI inspection/acceptance dimensions, keyboard focus, reduced motion and real targets.
    await alice.page.goto(`/thanh-vien/${bob.userId}`);
    await expect(alice.page.getByRole('heading', { name: 'Kết nối' })).toBeVisible();
    await alice.page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await alice.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await alice.page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
    await alice.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const unfriendButton = alice.page.getByRole('button', { name: 'Hủy kết bạn' });
    let foundKeyboardFocus = false;
    for (let index = 0; index < 24; index += 1) {
      if (await unfriendButton.evaluate((element) => element === document.activeElement)) {
        foundKeyboardFocus = true;
        break;
      }
      await alice.page.keyboard.press('Tab');
    }
    expect(foundKeyboardFocus).toBe(true);
    expect(await unfriendButton.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    expect(await unfriendButton.evaluate((element) => element.getBoundingClientRect().height >= 44)).toBe(true);
    for (const width of [1440, 768, 390, 320]) {
      await alice.page.setViewportSize({ width, height: 900 });
      await expect(alice.page.getByRole('heading', { name: 'Kết nối' })).toBeVisible();
      expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Unexpected horizontal overflow at ${width}px`).toBe(true);
    }

    // Final graph state and records are API-created; no friendship was seeded directly.
    await expectPair(driver, alice.userId, bob.userId, {
      status: 'ACCEPTED', requestId: secondRequest.request.id, friendshipId: secondFriendshipId, edges: 1,
    });
    await expectPair(driver, alice.userId, cara.userId, {
      status: 'ACCEPTED', requestId: finalSendToCara.request.id, friendshipId: caraFriendshipId, edges: 1,
    });
    await expectPair(driver, dee.userId, cara.userId, { status: 'PENDING', requestId: deeToCara.request.id, friendshipId: null, edges: 0 });
    await expectPair(driver, erin.userId, cara.userId, { status: 'PENDING', requestId: erinToCara.request.id, friendshipId: null, edges: 0 });
    await assertNoUnownedEdges(driver, manifest);
  } catch (error) {
    scenarioFailure = error;
    throw error;
  } finally {
    // Every browser context closes before the exact, transactional ownership cleanup begins.
    for (const browserContext of contexts) {
      try { await browserContext.close(); } catch { /* A failed test may already have closed a context. */ }
    }
    if (manifest.pairs.length || manifest.fixtures.length) {
      try {
        const cleanupDriver = neo4j.driver(
          process.env.NEO4J_URI!,
          neo4j.auth.basic(process.env.NEO4J_TEST_USERNAME!, process.env.NEO4J_TEST_PASSWORD!),
        );
        try {
          await cleanupRun(cleanupDriver, manifestPath, manifest, initialBaseline);
        } finally {
          await cleanupDriver.close();
        }
        cleanupSucceeded = true;
      } catch (cleanupError) {
        if (!cleanupSucceeded) await saveRunManifest(manifestPath, manifest);
        if (scenarioFailure) throw new AggregateError([scenarioFailure, cleanupError], 'Browser scenario failed and owned-fixture cleanup also failed.');
        throw cleanupError;
      }
    }
  }
});

async function registerAndLogin(
  page: Page,
  context: BrowserContext,
  email: string,
  manifestPath: string,
  manifest: any,
): Promise<Actor> {
  await page.goto('/dang-ky');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu' }).fill(password);
  const registrationPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Tạo tài khoản/ }).click();
  const registration = await registrationPromise;
  expect(registration.status()).toBe(201);
  await expect(page.getByText('Tạo tài khoản thành công.', { exact: false })).toBeVisible();
  const registrationBody = await registration.json();
  const userId = registrationBody.user.id as string;
  const ownership = driver.session({ database: 'isn-test' });
  try {
    await registerOwnedFixture(ownership, manifest, manifestPath, email, userId);
  } finally {
    await ownership.close();
  }

  await page.goto('/dang-nhap');
  await page.getByLabel('Địa chỉ email').fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  const loginPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  const login = await loginPromise;
  expect(login.status()).toBe(200);
  const loginBody = await login.json();
  const csrfToken = loginBody.csrfToken as string;
  const session = driver.session({ database: 'isn-test' });
  try {
    const row = await session.run('MATCH (user:User {id:$userId,email:$email}) RETURN user.displayName AS displayName', { userId, email });
    expect(row.records).toHaveLength(1);
    await refreshOwnedAuthRecords(session, manifest, manifestPath,
      manifest.fixtures.find((fixture: { userId: string }) => fixture.userId === userId));
    const displayName = row.records[0]?.get('displayName') as string;
    await expect(page.getByRole('link', { name: 'Hồ sơ của tôi' })).toBeVisible();
    return { email, userId, displayName, context, page, csrfToken };
  } finally {
    await session.close();
  }
}

async function discoverMember(page: Page, member: Actor): Promise<void> {
  await page.goto('/kham-pha');
  await page.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' }).fill(member.displayName);
  await page.getByRole('button', { name: /Tìm kiếm/ }).click();
  const memberLink = page.getByRole('link', { name: member.displayName, exact: true });
  await expect(memberLink).toBeVisible();
  await memberLink.click();
  await expect(page.getByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
}

async function sendFromDiscovery(
  sender: Actor,
  recipient: Actor,
  manifestPath: string,
  manifest: any,
): Promise<{ status: number; request: { id: string }; response: APIResponse }> {
  await discoverMember(sender.page, recipient);
  const responsePromise = waitForFriendshipResponse(sender.page, 'POST', '/friendships/requests');
  await sender.page.getByRole('button', { name: 'Kết bạn' }).click();
  const response = await responsePromise;
  const body = await response.json();
  if (response.status() === 201) {
    await recordRunRequest(manifestPath, manifest, pairKey(sender.userId, recipient.userId), body.request.id);
  }
  return { status: response.status(), request: body.request, response };
}

function waitForFriendshipResponse(page: Page, method: string, pathSuffix: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.startsWith('/api/friendships') && url.pathname.endsWith(pathSuffix) && response.request().method() === method;
  });
}

async function apiRequest(actor: Actor, method: string, path: string, body?: unknown, origin = webOrigin): Promise<APIResponse> {
  return actor.context.request.fetch(`${webOrigin}/api${path}`, {
    method,
    headers: { Origin: origin, 'X-CSRF-Token': actor.csrfToken },
    ...(body === undefined ? {} : { data: body }),
  });
}

async function withLimitOne(page: Page, work: () => Promise<void>): Promise<void> {
  const routeRequestsWithRealLimit = async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' &&
        (url.pathname === '/api/friendships' || url.pathname === '/api/friendships/requests')) {
      url.searchParams.set('limit', '1');
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  };
  await page.route('**/api/friendships**', routeRequestsWithRealLimit);
  try {
    await work();
  } finally {
    await page.unroute('**/api/friendships**', routeRequestsWithRealLimit);
  }
}

async function expectPair(
  driver: Driver,
  firstId: string,
  secondId: string,
  expected: { status: string; requestId: string; friendshipId: string | null; edges: number },
): Promise<void> {
  const snapshot = await readPair(driver, firstId, secondId);
  expect(snapshot.status).toBe(expected.status);
  expect(snapshot.requestId).toBe(expected.requestId);
  expect(snapshot.friendshipId).toBe(expected.friendshipId);
  expect(snapshot.edges).toBe(expected.edges);
  if (expected.status === 'ACCEPTED' && expected.friendshipId) {
    expect(snapshot.edgeId).toBe(expected.friendshipId);
    expect(snapshot.lowUserId).toBe(firstId < secondId ? firstId : secondId);
    expect(snapshot.highUserId).toBe(firstId < secondId ? secondId : firstId);
    expect(snapshot.edgeLowUserId).toBe(snapshot.lowUserId);
    expect(snapshot.edgeHighUserId).toBe(snapshot.highUserId);
    expect(snapshot.edgeSince).toBe(snapshot.friendsSince);
  } else {
    expect(snapshot.edgeId).toBeNull();
  }
}

async function readPair(driver: Driver, firstId: string, secondId: string) {
  const low = firstId < secondId ? firstId : secondId;
  const high = firstId < secondId ? secondId : firstId;
  const pairKey = `${low}:${high}`;
  const session = driver.session({ database: 'isn-test' });
  try {
    const result = await session.run(
      `MATCH (pair:FriendshipPair {pairKey:$pairKey})
       OPTIONAL MATCH (edgeLow:User)-[edge:FRIEND_WITH {pairKey:$pairKey}]->(edgeHigh:User)
       RETURN pair.lowUserId AS lowUserId,pair.highUserId AS highUserId,pair.requestId AS requestId,
         pair.requestStatus AS status,pair.friendshipId AS friendshipId,
         toString(pair.friendsSince) AS friendsSince,count(edge) AS edges,collect(edge.id) AS edgeIds,
         collect(edgeLow.id) AS edgeLowIds,collect(edgeHigh.id) AS edgeHighIds,
         collect(toString(edge.since)) AS edgeTimes`,
      { pairKey },
    );
    assert.equal(result.records.length, 1);
    const row = result.records[0]!;
    const edgeIds = row.get('edgeIds') as (string | null)[];
    const lowIds = row.get('edgeLowIds') as (string | null)[];
    const highIds = row.get('edgeHighIds') as (string | null)[];
    const times = row.get('edgeTimes') as (string | null)[];
    return {
      lowUserId: row.get('lowUserId'), highUserId: row.get('highUserId'), requestId: row.get('requestId'),
      status: row.get('status'), friendshipId: row.get('friendshipId'), friendsSince: row.get('friendsSince'),
      edges: row.get('edges').toNumber(), edgeId: edgeIds[0] ?? null,
      edgeLowUserId: lowIds[0] ?? null, edgeHighUserId: highIds[0] ?? null, edgeSince: times[0] ?? null,
    };
  } finally {
    await session.close();
  }
}

async function assertNoUnownedEdges(driver: Driver, manifest: any): Promise<void> {
  const session = driver.session({ database: 'isn-test' });
  try {
    const ids = manifest.fixtures.map((fixture: { userId: string }) => fixture.userId);
    const result = await session.run(
      `MATCH (low:User)-[edge:FRIEND_WITH]->(high:User)
       WHERE low.id IN $ids OR high.id IN $ids
       RETURN low.id AS low,high.id AS high,edge.id AS id,edge.pairKey AS pairKey`, { ids },
    );
    for (const record of result.records) {
      const pair = manifest.pairs.find((candidate: { pairKey: string }) => candidate.pairKey === record.get('pairKey'));
      assert.ok(pair, 'Unexpected friendship relationship touches a run-owned account');
      assert.ok(pair.friendshipIds.includes(record.get('id')));
      assert.equal(record.get('low'), pair.lowUserId);
      assert.equal(record.get('high'), pair.highUserId);
    }
  } finally {
    await session.close();
  }
}

function pairKey(firstId: string, secondId: string): string {
  const low = firstId < secondId ? firstId : secondId;
  const high = firstId < secondId ? secondId : firstId;
  return `${low}:${high}`;
}
