import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostsPage } from '../api/posts-api';

const mocks = vi.hoisted(() => ({ createPost: vi.fn(), listFeed: vi.fn(), retry: vi.fn() }));
vi.mock('../api/posts-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/posts-api')>(),
  createPost: mocks.createPost,
  listFeed: mocks.listFeed,
}));
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ retry: mocks.retry }) }));

import { PostsApiError } from '../api/posts-api';
import { FeedPage } from './feed-page';

const emptyPage: PostsPage = {
  items: [],
  pagination: { limit: 20, hasMore: false, nextCursor: null },
};

afterEach(cleanup);

describe('FeedPage uncertain create reconciliation', () => {
  it('only enables the manual retry choice after the refreshed Feed request completes', async () => {
    let finishRefresh!: (page: PostsPage) => void;
    mocks.listFeed.mockReset()
      .mockResolvedValueOnce(emptyPage)
      .mockImplementationOnce(() => new Promise<PostsPage>((resolve) => { finishRefresh = resolve; }));
    mocks.createPost.mockReset().mockRejectedValueOnce(
      new PostsApiError('Outcome unknown', 503, 'WRITE_OUTCOME_UNKNOWN'),
    );
    const user = userEvent.setup();
    render(<FeedPage />);
    await screen.findByText('Chưa có bài viết nào để hiển thị.');
    await user.type(screen.getByRole('textbox', { name: 'Nội dung bài viết' }), 'Preserve this draft');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    await screen.findByText('Không gửi lại tự động để tránh đăng trùng. Bản nháp vẫn được giữ nguyên.');

    await user.click(screen.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }));
    expect(mocks.listFeed).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).not.toBeInTheDocument();
    finishRefresh(emptyPage);

    expect(await screen.findByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Nội dung bài viết' })).toHaveValue('Preserve this draft');
  });
});
