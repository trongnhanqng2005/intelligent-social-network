import { expect, test, type Page } from '@playwright/test';

async function simulateAnonymousSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }) }),
  );
}

test('the API health contract remains available through Vite independently of the public homepage', async ({ page }) => {
  const response = await page.request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('anonymous visitors see the Weylume homepage without a developer health request', async ({ page }) => {
  await simulateAnonymousSession(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));

  await page.goto('/');

  await expect(page.getByRole('banner').getByRole('link', { name: 'Weylume — Trang chủ' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Kết nối có ý nghĩa, bắt đầu từ bạn.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toHaveAttribute('href', '/dang-nhap');
  await expect(page.getByRole('link', { name: 'Tạo tài khoản' }).first()).toHaveAttribute('href', '/dang-ky');
  await expect(page.getByText(/đang trong giai đoạn phát triển/i)).toHaveCount(0);
  await expect(page.locator('.api-health-card')).toHaveCount(0);
  expect(requests).not.toContain('/api/health');
  expect(requests).toContain('/api/auth/session');
});

test('homepage navigation, CTAs, section anchors and redesigned not-found links work', async ({ page }) => {
  await simulateAnonymousSession(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Giới thiệu', exact: true }).first().click();
  await expect(page).toHaveURL(/#gioi-thieu$/);
  await expect(page.getByRole('heading', { name: 'Điều khiến chúng ta gần nhau thường bắt đầu từ một điểm chung.' })).toBeVisible();
  await page.getByRole('link', { name: 'Giá trị', exact: true }).click();
  await expect(page).toHaveURL(/#gia-tri$/);
  await expect(page.getByRole('heading', { name: 'Kết nối, bằng sự quan tâm.' })).toBeVisible();

  await page.getByRole('link', { name: 'Tạo tài khoản' }).first().click();
  await expect(page).toHaveURL('/dang-ky');
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
  await page.getByRole('link', { name: 'Weylume — Trang chủ' }).click();
  await page.getByRole('link', { name: 'Đăng nhập' }).first().click();
  await expect(page).toHaveURL('/dang-nhap');
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Liên kết cuối trang' }).getByRole('link', { name: 'Tạo tài khoản' }).click();
  await expect(page).toHaveURL('/dang-ky');
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();

  await page.goto('/an-unknown-route');
  await expect(page.getByRole('heading', { level: 1, name: 'Trang này chưa có ở đây.' })).toBeVisible();
  await expect(page.getByText('Địa chỉ có thể đã thay đổi. Hãy quay lại Weylume để tiếp tục.')).toBeVisible();
  await page.getByRole('link', { name: 'Quay về trang chủ' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Kết nối có ý nghĩa, bắt đầu từ bạn.' })).toBeVisible();
});

test('skip links move keyboard focus to the homepage content and authentication form', async ({ page }) => {
  await simulateAnonymousSession(page);
  await page.goto('/');

  await page.keyboard.press('Tab');
  const homeSkipLink = page.getByRole('link', { name: 'Đi đến nội dung chính' });
  await expect(homeSkipLink).toBeFocused();
  await page.keyboard.press('Enter');
  const homeTarget = page.locator('#noi-dung');
  await expect(homeTarget).toBeFocused();
  expect(await homeTarget.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');

  await page.goto('/dang-ky');
  await page.keyboard.press('Tab');
  const authSkipLink = page.getByRole('link', { name: 'Đi đến biểu mẫu' });
  await expect(authSkipLink).toBeFocused();
  await page.keyboard.press('Enter');
  const authTarget = page.locator('#auth-form');
  await expect(authTarget).toBeFocused();
  expect(await authTarget.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
});

test('simulated session outage offers a retry and recovers to anonymous browsing', async ({ page }) => {
  let recovering = false;
  let recoveryAttempts = 0;
  await page.route('**/api/auth/session', (route) => {
    if (recovering) {
      recoveryAttempts += 1;
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHENTICATED"}}' });
    }
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"unavailable"}}' });
  });
  await page.goto('/');

  await expect(page.getByText('Chưa thể xác minh phiên đăng nhập.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tạo tài khoản' }).first()).toBeVisible();
  recovering = true;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toBeVisible();
  await expect(page.getByText('Chưa thể xác minh phiên đăng nhập.')).toHaveCount(0);
  expect(recoveryAttempts).toBeGreaterThan(0);
});

test('a malformed session response does not authenticate the visitor', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null,"session":{}}' }),
  );
  await page.goto('/');

  await expect(page.getByText('Chưa thể xác minh phiên đăng nhập.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chào mừng bạn trở lại.' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Đăng nhập' }).first()).toBeVisible();
});

test('responsive routes fit the viewport and keyboard focus and reduced motion remain usable', async ({ page }) => {
  await simulateAnonymousSession(page);
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Kết nối có ý nghĩa, bắt đầu từ bạn.' })).toBeVisible();
    const homeWidths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(homeWidths.document, `homepage at ${width}px`).toBeLessThanOrEqual(homeWidths.viewport);
    const cta = page.getByRole('link', { name: 'Tạo tài khoản' }).first();
    const box = await cta.boundingBox();
    expect(box, `homepage CTA at ${width}px`).not.toBeNull();
    expect(box!.height, `homepage CTA target at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Giới thiệu', exact: true }).click();
    await expect(page).toHaveURL(/#gioi-thieu$/);
    await expect(page.getByRole('heading', { name: 'Điều khiến chúng ta gần nhau thường bắt đầu từ một điểm chung.' })).toBeVisible();

    await page.goto('/dang-ky');
    await expect(page.getByRole('textbox', { name: 'Xác nhận mật khẩu' })).toBeVisible();
    const formWidths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(formWidths.document, `registration at ${width}px`).toBeLessThanOrEqual(formWidths.viewport);
    await page.goto('/dang-nhap');
    await expect(page.getByRole('textbox', { name: 'Mật khẩu' })).toBeVisible();
    const loginWidths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(loginWidths.document, `login at ${width}px`).toBeLessThanOrEqual(loginWidths.viewport);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Đi đến nội dung chính' });
  await expect(skipLink).toBeFocused();
  const focusOutline = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusOutline).toEqual({ outlineStyle: 'solid', outlineWidth: '3px' });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#noi-dung$/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.evaluate(() => ({
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    entranceDuration: getComputedStyle(document.querySelector('.hero-art-wrap')!).animationDuration,
  }));
  expect(motion).toEqual({ reduced: true, scroll: 'auto', entranceDuration: '1e-05s' });
});
