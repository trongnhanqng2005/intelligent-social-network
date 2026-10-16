import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostsPage, PostView } from '../api/posts-api';
const mocks = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock('../../auth/model/auth-context', () => ({
  useAuth: () => ({ state: { status: 'authenticated', session: { user: { id: 'viewer' } } }, retry: mocks.retry }),
}));
vi.mock('./post-card', () => ({
  PostCard: ({ post }: { post: PostView }) => <article data-testid="post-card">{post.content}</article>,
}));

import { PostList } from './post-list';

const first: PostView = {
  id: 'one', content: 'Bài viết thứ nhất', visibility: 'friends', createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z', version: 0,
  author: { id: 'author', displayName: 'Bạn', bio: null, location: null },
  permissions: { canEdit: false, canDelete: false },
};
const second = { ...first, id: 'two', content: 'Bài viết thứ hai' };

function page(items: PostView[], hasMore = false, nextCursor: string | null = null): PostsPage {
  return { items, pagination: { limit: 1, hasMore, nextCursor } };
}

afterEach(cleanup);

describe('PostList', () => {
  it('loads chronologically and uses explicit Load More with UUID deduplication', async () => {
    const user = userEvent.setup();
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page([first], true, 'next'))
      .mockResolvedValueOnce(page([first, second]));
    render(<PostList loadPage={loadPage} refreshKey={0} />);
    expect(await screen.findByText('Bài viết thứ nhất')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tải thêm bài viết' }));
    expect(await screen.findByText('Bài viết thứ hai')).toBeVisible();
    expect(screen.getAllByTestId('post-card')).toHaveLength(2);
    expect(loadPage.mock.calls[1]?.[0]).toBe('next');
  });

  it('preserves already-loaded Posts and offers a retry after Load More fails', async () => {
    const user = userEvent.setup();
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page([first], true, 'next'))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(page([second]));
    render(<PostList loadPage={loadPage} refreshKey={0} />);
    expect(await screen.findByText('Bài viết thứ nhất')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tải thêm bài viết' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByText('Bài viết thứ nhất')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Thử tải thêm' }));
    expect(await screen.findByText('Bài viết thứ hai')).toBeVisible();
  });

  it('clears potentially inaccessible cached profile Posts before relationship refresh results arrive', async () => {
    let resolveRefresh!: (value: PostsPage) => void;
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page([first]))
      .mockImplementationOnce(() => new Promise<PostsPage>((resolve) => { resolveRefresh = resolve; }));
    const view = render(<PostList loadPage={loadPage} refreshKey={0} clearOnRefreshKeyChange />);
    expect(await screen.findByText('Bài viết thứ nhất')).toBeVisible();
    view.rerender(<PostList loadPage={loadPage} refreshKey={1} clearOnRefreshKeyChange />);
    expect(screen.queryByText('Bài viết thứ nhất')).not.toBeInTheDocument();
    resolveRefresh(page([]));
    await waitFor(() => expect(screen.getByText('Chưa có bài viết nào để hiển thị.')).toBeVisible());
  });

  it('preserves loaded cards across an ordinary refresh while replacing data', async () => {
    let finishRefresh!: (value: PostsPage) => void;
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page([first]))
      .mockImplementationOnce(() => new Promise<PostsPage>((resolve) => { finishRefresh = resolve; }));
    const user = userEvent.setup();
    render(<PostList loadPage={loadPage} refreshKey={0} />);
    expect(await screen.findByText('Bài viết thứ nhất')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tải mới' }));
    expect(screen.getByText('Bài viết thứ nhất')).toBeVisible();
    finishRefresh(page([second]));
    expect(await screen.findByText('Bài viết thứ hai')).toBeVisible();
    expect(screen.queryByText('Bài viết thứ nhất')).not.toBeInTheDocument();
  });

  it('keeps loaded cards visible when an ordinary refresh fails', async () => {
    const loadPage = vi.fn().mockResolvedValueOnce(page([first])).mockRejectedValueOnce(new Error('Offline'));
    const user = userEvent.setup();
    render(<PostList loadPage={loadPage} refreshKey={0} />);
    expect(await screen.findByText('Bài viết thứ nhất')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tải mới' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByText('Bài viết thứ nhất')).toBeVisible();
  });

  it('ignores a controlled obsolete response delivered after the newer Feed response', async () => {
    let deliverObsolete!: (value: PostsPage) => void;
    const loadPage = vi.fn()
      .mockImplementationOnce(() => new Promise<PostsPage>((resolve) => { deliverObsolete = resolve; }))
      .mockResolvedValueOnce(page([second]));
    const view = render(<PostList loadPage={loadPage} refreshKey={0} />);
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));

    view.rerender(<PostList loadPage={loadPage} refreshKey={1} />);
    expect(await screen.findByText('Bài viết thứ hai')).toBeVisible();
    expect(loadPage.mock.calls[0]?.[1]?.aborted).toBe(true);
    deliverObsolete(page([first]));

    await waitFor(() => expect(screen.queryByText('Bài viết thứ nhất')).not.toBeInTheDocument());
    expect(screen.getByText('Bài viết thứ hai')).toBeVisible();
    expect(screen.getAllByTestId('post-card')).toHaveLength(1);
  });
});
