import { expect, test } from '@playwright/test';

const healthPath = '**/api/health';

test('home page connects to the live API through the Vite proxy', async ({ page }) => {
  const healthResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/health',
  );

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Kết nối bắt đầu từ những điều giản dị.' })).toBeVisible();
  const healthResponse = await healthResponsePromise;
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toEqual({ status: 'ok' });
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible();
  await expect(page.locator('.api-health-card [role="status"]')).toHaveText('API đang hoạt động bình thường.');
});

test('unknown routes show the not-found page and return home', async ({ page }) => {
  await page.goto('/an-unknown-route');

  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  await expect(page.getByText('Trang bạn đang tìm không tồn tại.')).toBeVisible();
  await page.getByRole('link', { name: 'Quay về trang chủ' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Kết nối bắt đầu từ những điều giản dị.' })).toBeVisible();
});

test('an invalid health payload never displays a connected state', async ({ page }) => {
  await page.route(healthPath, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"warming"}' }),
  );
  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText(
    'Dịch vụ trả về trạng thái không mong đợi.',
  );
  await expect(page.getByText('Đã kết nối', { exact: true })).toHaveCount(0);
  await expect(page.locator('.api-health-card').getByRole('button', { name: 'Thử kết nối lại' })).toBeVisible();
});

test('retry recovers from a simulated HTTP failure using the real API', async ({ page }) => {
  await page.route(healthPath, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText('Dịch vụ trả về lỗi HTTP 503.');
  await expect(page.getByText('Đã kết nối', { exact: true })).toHaveCount(0);

  await page.unroute(healthPath);
  const recoveryResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/health',
  );
  await page.locator('.api-health-card').getByRole('button', { name: 'Thử kết nối lại' }).click();

  const recoveryResponse = await recoveryResponsePromise;
  expect(recoveryResponse.status()).toBe(200);
  expect(await recoveryResponse.json()).toEqual({ status: 'ok' });
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible();
  await expect(page.locator('.api-health-card').getByRole('button', { name: 'Thử kết nối lại' })).toHaveCount(0);
});

test('retry is keyboard reachable, visibly focused and activatable', async ({ page }) => {
  await page.route(healthPath, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Không thể kết nối đến dịch vụ.');

  const retryButton = page.locator('.api-health-card').getByRole('button', { name: 'Thử kết nối lại' });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await retryButton.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(retryButton).toBeFocused();
  const focusStyle = await retryButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '3px' });

  await page.unroute(healthPath);
  const recoveryResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/health',
  );
  await page.keyboard.press('Enter');

  expect((await recoveryResponsePromise).status()).toBe(200);
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible();
});

test('the responsive home page and retry control fit the viewport', async ({ page }) => {
  await page.route(healthPath, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width);
  expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.width);

  const retryButton = page.locator('.api-health-card').getByRole('button', { name: 'Thử kết nối lại' });
  const buttonBox = await retryButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewport.width);
  await expect(page.getByRole('heading', { name: 'Kết nối bắt đầu từ những điều giản dị.' })).toBeVisible();
});
