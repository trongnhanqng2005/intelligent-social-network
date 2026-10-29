import { expect, test } from '@playwright/test';

const post = {
  id: '33333333-3333-4333-8333-333333333333', content: 'Private original', visibility: 'friends',
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', version: 0,
  author: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Owner', bio: null, location: null },
  permissions: { canEdit: true, canDelete: true },
};

for (const outcome of ['same', 'revoked', 'different'] as const) {
  test(`detail draft with ${outcome} session on focus`, async ({ page }) => {
    let sessionState: 'same' | 'revoked' | 'different' = 'same';
    await page.route((url) => url.origin === 'http://127.0.0.1:5199' && url.pathname.startsWith('/api/'), async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/session') {
        if (sessionState === 'revoked') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
        const id = sessionState === 'different' ? '22222222-2222-4222-8222-222222222222' : post.author.id;
        return route.fulfill({ json: { user: { id, email: 'synthetic@example.invalid' }, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
      }
      if (path === `/api/posts/${post.id}`) {
        if (sessionState === 'different') return route.fulfill({ status: 404, json: { error: { code: 'POST_NOT_FOUND' } } });
        return route.fulfill({ json: { post } });
      }
      return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    });
    await page.goto(`/bai-viet/${post.id}`);
    await page.getByRole('button', { name: 'Chỉnh sửa bài viết' }).click();
    const draft = page.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await draft.fill('Unsaved private draft');
    sessionState = outcome;
    const revalidation = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/session');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await revalidation;
    if (outcome === 'same') await expect(draft).toHaveValue('Unsaved private draft');
    else {
      await expect(draft).toHaveCount(0);
      await expect(page.getByText('Private original')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toHaveCount(0);
    }
  });
}

test('account switch clears Feed draft and rejects the previous viewer delayed response', async ({ page }) => {
  let viewer = post.author.id;
  let hold = false;
  let release!: () => void;
  let arrived!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const received = new Promise<void>((resolve) => { arrived = resolve; });
  await page.route((url) => url.origin === 'http://127.0.0.1:5199' && url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: viewer, email: 'synthetic@example.invalid' }, session: { expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    if (path === '/api/feed') {
      const snapshot = viewer === post.author.id ? [post] : [];
      if (hold && viewer === post.author.id) { arrived(); await pending; }
      return route.fulfill({ json: { items: snapshot, pagination: { limit: 20, hasMore: false, nextCursor: null } } }).catch(() => {});
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  try {
    await page.goto('/bang-tin');
    await expect(page.getByText('Private original')).toBeVisible();
    await page.getByRole('textbox', { name: 'Nội dung bài viết' }).fill('Old account draft');
    hold = true;
    await page.getByRole('button', { name: 'Tải mới' }).click();
    await received;
    viewer = '22222222-2222-4222-8222-222222222222';
    const session = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/session');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await session;
    await expect(page.getByRole('textbox', { name: 'Nội dung bài viết' })).toHaveValue('');
    release();
    await expect(page.getByText('Private original')).toHaveCount(0);
  } finally { release(); }
});
