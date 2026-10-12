import { expect, test } from '@playwright/test';

const healthPath = '**/api/health';

test('home page connects to the live API through the Vite proxy', async ({ page }) => {
  const healthResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/health',
  );

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'A foundation to build on.' })).toBeVisible();
  const healthResponse = await healthResponsePromise;
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toEqual({ status: 'ok' });
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('The API is responding normally.');
});

test('unknown routes show the not-found page and return home', async ({ page }) => {
  await page.goto('/an-unknown-route');

  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByText('The page you requested does not exist.')).toBeVisible();
  await page.getByRole('link', { name: 'Return to home' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'A foundation to build on.' })).toBeVisible();
});

test('an invalid health payload never displays a connected state', async ({ page }) => {
  await page.route(healthPath, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"warming"}' }),
  );
  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText(
    'The API returned an unexpected health response.',
  );
  await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
});

test('retry recovers from a simulated HTTP failure using the real API', async ({ page }) => {
  await page.route(healthPath, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText('The API returned HTTP 503.');
  await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);

  await page.unroute(healthPath);
  const recoveryResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/health',
  );
  await page.getByRole('button', { name: 'Retry connection' }).click();

  const recoveryResponse = await recoveryResponsePromise;
  expect(recoveryResponse.status()).toBe(200);
  expect(await recoveryResponse.json()).toEqual({ status: 'ok' });
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0);
});

test('retry is keyboard reachable, visibly focused and activatable', async ({ page }) => {
  await page.route(healthPath, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The API could not be reached.');

  const retryButton = page.getByRole('button', { name: 'Retry connection' });
  await page.keyboard.press('Tab');
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
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
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

  const retryButton = page.getByRole('button', { name: 'Retry connection' });
  const buttonBox = await retryButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(viewport.width);
  await expect(page.getByRole('heading', { name: 'A foundation to build on.' })).toBeVisible();
});
