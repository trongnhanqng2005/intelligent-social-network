import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import {
  assessPostsScenarioResourceCapacity,
  collectPostsScenarioResourceInventory,
} from '../../fixtures/posts/resource-safety.mjs';

export async function runInteractionsBrowser({ app, origin, root, account, password, postId }) {
  const capacity = assessPostsScenarioResourceCapacity(
    collectPostsScenarioResourceInventory({ sampleCount: 3, intervalSeconds: 1 }),
  );
  assert.equal(capacity.safe, true, capacity.issues.join(' '));
  assert.equal(app.getHttpServer().listening, true);
  const apiUrl = await app.getUrl();
  const web = await preview({
    configFile: false,
    root: resolve(root, 'apps/web'),
    preview: {
      host: '127.0.0.1',
      port: Number(new URL(origin).port),
      strictPort: true,
      proxy: { '/api': { target: apiUrl, rewrite: (path) => path.slice(4) } },
    },
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ baseURL: origin });
    await page.goto('/dang-nhap');
    await page.locator('input[type=email]').fill(account.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/dang-nhap');
    await page.goto('/bai-viet/' + postId);

    const like = page.getByRole('button', { name: /^Thích ·/u });
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await like.click();
    const liked = page.getByRole('button', { name: /^Đã thích ·/u });
    await expect(liked).toHaveAttribute('aria-pressed', 'true');
    await liked.click();
    await expect(like).toHaveAttribute('aria-pressed', 'false');

    const draft = page.getByLabel('Viết bình luận');
    await draft.fill('  Bình luận từ trình duyệt  ');
    await page.getByRole('button', { name: 'Đăng bình luận' }).click();
    await expect(draft).toHaveValue('');
    await expect(page.getByText('Bình luận từ trình duyệt', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sửa', exact: true }).click();
    await page.getByLabel('Chỉnh sửa bình luận').fill('Bình luận đã chỉnh sửa');
    await page.getByRole('button', { name: 'Lưu bình luận' }).click();
    await expect(page.getByText('Bình luận đã chỉnh sửa', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(page.getByText('Bình luận đã chỉnh sửa', { exact: true })).toHaveCount(0);
  } finally {
    await browser?.close();
    await new Promise((done, reject) => web.httpServer.close((error) => error ? reject(error) : done()));
  }
}
