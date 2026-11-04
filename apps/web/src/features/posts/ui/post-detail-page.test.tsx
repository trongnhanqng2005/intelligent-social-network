import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { PostView } from '../api/posts-api';

const mocks = vi.hoisted(() => ({ getPost: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn(), retry: vi.fn() }));
vi.mock('../api/posts-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/posts-api')>(),
  getPost: mocks.getPost,
  updatePost: mocks.updatePost,
  deletePost: mocks.deletePost,
}));
vi.mock('../../auth/model/auth-context', () => ({
  useAuth: () => ({ state: { status: 'authenticated', session: { user: { id: 'author' } } }, retry: mocks.retry }),
}));

import { PostsApiError } from '../api/posts-api';
import { PostDetailPage } from './post-detail-page';

const postA: PostView = {
  id: 'post-a', content: 'Post A', visibility: 'friends',
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', version: 0,
  author: { id: 'author', displayName: 'Author', bio: null, location: null },
  permissions: { canEdit: true, canDelete: true },
};
const postB: PostView = { ...postA, id: 'post-b', content: 'Post B' };

function CurrentPath() {
  return <output>{useLocation().pathname}</output>;
}

function DetailRoutes() {
  return (
    <MemoryRouter initialEntries={['/bai-viet/post-a']}>
      <Link to="/bai-viet/post-b">Open Post B</Link>
      <CurrentPath />
      <Routes><Route path="/bai-viet/:postId" element={<PostDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.getPost.mockImplementation(async (id: string) => ({ ...(id === 'post-a' ? postA : postB) }));
  mocks.updatePost.mockReset();
  mocks.deletePost.mockReset();
});
afterEach(cleanup);

describe('PostDetailPage route identity', () => {
  it.each([401, 404])('does not restore a post when an older focus read succeeds after a manual retry returns %i', async (status) => {
    let finishFocusRead!: (value: PostView) => void;
    mocks.getPost.mockRejectedValueOnce(new PostsApiError('Initial read failed', 503, 'SERVICE_UNAVAILABLE'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishFocusRead = resolve; }))
      .mockRejectedValueOnce(new PostsApiError('Access unavailable', status, status === 404 ? 'POST_NOT_FOUND' : 'UNAUTHENTICATED'));
    const user = userEvent.setup();
    render(<DetailRoutes />);
    await screen.findByRole('button', { name: 'Thử tải lại' });

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.focus(window);
    await waitFor(() => expect(finishFocusRead).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Thử tải lại' }));
    await waitFor(() => expect(screen.getByText(status === 404
      ? 'Không tìm thấy bài viết hoặc bạn không có quyền xem bài viết này.'
      : 'Access unavailable')).toBeVisible());

    finishFocusRead(postA);
    await waitFor(() => expect(screen.queryByText('Post A')).not.toBeInTheDocument());
    expect(screen.getByText(status === 404
      ? 'Không tìm thấy bài viết hoặc bạn không có quyền xem bài viết này.'
      : 'Access unavailable')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa bài viết' })).not.toBeInTheDocument();
  });

  it('revalidates on focus, preserving a draft when visible and clearing it after access is revoked', async () => {
    const user = userEvent.setup();
    render(<DetailRoutes />);
    await screen.findByText('Post A');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const draft = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(draft);
    await user.type(draft, 'Unsaved draft');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.getPost).toHaveBeenCalledTimes(2));
    expect(draft).toHaveValue('Unsaved draft');
    mocks.getPost.mockRejectedValueOnce(new PostsApiError('Not found', 404, 'POST_NOT_FOUND'));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' })).not.toBeInTheDocument());
    expect(screen.getByText('Không tìm thấy bài viết hoặc bạn không có quyền xem bài viết này.')).toBeVisible();
  });
  it('ignores a late Post A edit completion after navigating to Post B', async () => {
    let finishUpdate!: (value: PostView) => void;
    mocks.updatePost.mockImplementation(() => new Promise((resolve) => { finishUpdate = resolve; }));
    const user = userEvent.setup();
    render(<DetailRoutes />);
    await screen.findByText('Post A');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.type(editor, 'Late Post A update');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await user.click(screen.getByRole('link', { name: 'Open Post B' }));
    await screen.findByText('Post B');

    finishUpdate({ ...postA, content: 'Late Post A update', version: 1 });
    await waitFor(() => expect(screen.getByText('Post B')).toBeVisible());
    expect(screen.queryByText('Late Post A update')).not.toBeInTheDocument();
    expect(screen.getByText('/bai-viet/post-b')).toBeVisible();
  });

  it('does not navigate away when a Post A delete resolves after navigating to Post B', async () => {
    let finishDelete!: (value?: unknown) => void;
    mocks.deletePost.mockImplementation(() => new Promise((resolve) => { finishDelete = resolve; }));
    const user = userEvent.setup();
    render(<DetailRoutes />);
    await screen.findByText('Post A');
    await user.click(screen.getByRole('button', { name: 'Xóa bài viết' }));
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await user.click(screen.getByRole('link', { name: 'Open Post B' }));
    await screen.findByText('Post B');

    finishDelete();
    await waitFor(() => expect(screen.getByText('/bai-viet/post-b')).toBeVisible());
    expect(screen.getByText('Post B')).toBeVisible();
  });

  it('ignores a late reconciliation read for Post A after navigating to Post B', async () => {
    let finishReload!: (value: PostView) => void;
    mocks.updatePost.mockRejectedValueOnce(new PostsApiError('Conflict', 409, 'POST_CONFLICT'));
    mocks.getPost.mockImplementation((id: string) => {
      if (id === 'post-a' && mocks.getPost.mock.calls.filter(([calledId]) => calledId === 'post-a').length > 1) {
        return new Promise((resolve) => { finishReload = resolve; });
      }
      return Promise.resolve({ ...(id === 'post-a' ? postA : postB) });
    });
    const user = userEvent.setup();
    render(<DetailRoutes />);
    await screen.findByText('Post A');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await screen.findByText('Bản nháp vẫn được giữ. Tải phiên bản mới trước khi lưu tiếp.');
    await user.click(screen.getByRole('button', { name: 'Tải phiên bản mới' }));
    await waitFor(() => expect(finishReload).toBeDefined());
    await user.click(screen.getByRole('link', { name: 'Open Post B' }));
    await screen.findByText('Post B');

    finishReload({ ...postA, content: 'Refreshed Post A', version: 1 });
    await waitFor(() => expect(screen.getByText('/bai-viet/post-b')).toBeVisible());
    expect(screen.getByText('Post B')).toBeVisible();
    expect(screen.queryByText('Refreshed Post A')).not.toBeInTheDocument();
  });
});
