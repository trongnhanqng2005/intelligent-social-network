import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { PostsPage } from '../api/posts-api';

const mocks = vi.hoisted(() => ({ createPost: vi.fn(), listFeed: vi.fn(), updatePost: vi.fn(), retry: vi.fn() }));
vi.mock('../api/posts-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/posts-api')>(),
  createPost: mocks.createPost,
  listFeed: mocks.listFeed,
  updatePost: mocks.updatePost,
}));
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ state: { status: 'authenticated', session: { user: { id: 'viewer' } } }, retry: mocks.retry }) }));

import { PostsApiError } from '../api/posts-api';
import { FeedPage } from './feed-page';

const emptyPage: PostsPage = {
  items: [],
  pagination: { limit: 20, hasMore: false, nextCursor: null },
};

afterEach(cleanup);

describe('FeedPage uncertain create reconciliation', () => {
  it.each(['success', 'failure'] as const)('waits for its own refresh when an older Feed request is aborted (%s)', async (outcome) => {
    let olderSignal: AbortSignal | undefined;
    let finishNewer!: (page: PostsPage) => void;
    let failNewer!: (error: Error) => void;
    mocks.listFeed.mockReset().mockResolvedValueOnce(emptyPage)
      .mockImplementationOnce((_query, signal) => {
        olderSignal = signal;
        return new Promise<PostsPage>(() => {});
      })
      .mockImplementationOnce(() => new Promise<PostsPage>((resolve, reject) => {
        finishNewer = resolve;
        failNewer = reject;
      }));
    mocks.createPost.mockReset().mockRejectedValueOnce(new PostsApiError('Unknown', 503, 'WRITE_OUTCOME_UNKNOWN'));
    const user = userEvent.setup();
    render(<MemoryRouter><FeedPage /></MemoryRouter>);
    await screen.findByText('Chưa có bài viết nào để hiển thị.');

    await user.click(screen.getByRole('button', { name: 'Tải mới' }));
    await waitFor(() => expect(mocks.listFeed).toHaveBeenCalledTimes(2));
    await user.type(screen.getByRole('textbox', { name: 'Nội dung bài viết' }), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    await user.click(await screen.findByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }));
    await waitFor(() => expect(mocks.listFeed).toHaveBeenCalledTimes(3));

    expect(olderSignal?.aborted).toBe(true);
    expect(screen.getByText('Đang tải lại bảng tin để kiểm tra kết quả đăng bài.')).toBeVisible();
    expect(screen.queryByText('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nội dung bài viết' })).toHaveValue('Keep this draft');

    if (outcome === 'success') {
      finishNewer(emptyPage);
      await screen.findByText('Đã tải lại bảng tin. Hãy kiểm tra trước khi gửi lại bản nháp.');
      expect(screen.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).toBeEnabled();
    } else {
      failNewer(new Error('Feed unavailable'));
      await screen.findByText('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.');
      expect(screen.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' })).toBeEnabled();
    }
  });

  it('unlocks reconciliation as unsuccessful when an edit cancels the pending Feed refresh', async () => {
    const post = { id: 'post-1', content: 'Original', visibility: 'friends' as const,
      createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', version: 0,
      author: { id: 'viewer', displayName: 'Viewer', bio: null, location: null }, permissions: { canEdit: true, canDelete: true } };
    mocks.listFeed.mockReset().mockResolvedValueOnce({ ...emptyPage, items: [post] })
      .mockImplementationOnce(() => new Promise<PostsPage>(() => {}));
    mocks.createPost.mockReset().mockRejectedValueOnce(new PostsApiError('Unknown', 503, 'WRITE_OUTCOME_UNKNOWN'));
    mocks.updatePost.mockReset().mockResolvedValue({ ...post, content: 'Updated', version: 1 });
    const user = userEvent.setup();
    render(<MemoryRouter><FeedPage /></MemoryRouter>);
    await screen.findByText('Original');
    await user.type(screen.getByRole('textbox', { name: 'Nội dung bài viết' }), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    await user.click(await screen.findByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }));
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(screen.getByText('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.')).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' })).toBeEnabled();
  });
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
