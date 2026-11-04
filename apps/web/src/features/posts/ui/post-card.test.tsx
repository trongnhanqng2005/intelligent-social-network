import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostsApiError, type PostView } from '../api/posts-api';

const mocks = vi.hoisted(() => ({ updatePost: vi.fn(), deletePost: vi.fn(), getPost: vi.fn() }));
vi.mock('../api/posts-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/posts-api')>(),
  updatePost: mocks.updatePost,
  deletePost: mocks.deletePost,
  getPost: mocks.getPost,
}));
vi.mock('../../auth/model/auth-context', () => ({
  useAuth: () => ({ state: { status: 'authenticated', session: { user: { id: 'author-1' } } }, retry: vi.fn() }),
}));

import { useState } from 'react';
import { PostCard } from './post-card';

const initialPost: PostView = {
  id: 'post-1', content: '<img src=x onerror=alert(1)>\nXin chào 🌱', visibility: 'friends',
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', version: 0,
  author: { id: 'author-1', displayName: 'Nguyễn An', bio: null, location: null },
  permissions: { canEdit: true, canDelete: true },
};

function Harness({ onDeleted = vi.fn() }: { onDeleted?: (id: string) => void }) {
  const [post, setPost] = useState(initialPost);
  return <PostCard post={post} onUpdated={setPost} onDeleted={onDeleted} />;
}

beforeEach(() => {
  mocks.updatePost.mockReset();
  mocks.deletePost.mockReset();
  mocks.getPost.mockReset();
});
afterEach(cleanup);

describe('PostCard', () => {
  it('keeps the edit base version when a refresh updates the post', async () => {
    const user = userEvent.setup();
    mocks.updatePost.mockRejectedValue(new PostsApiError('Conflict', 409, 'POST_CONFLICT'));
    const renderCard = (post: PostView) => <MemoryRouter><PostCard post={post} onUpdated={vi.fn()} onDeleted={vi.fn()} /></MemoryRouter>;
    const view = render(renderCard(initialPost));
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    view.rerender(renderCard({ ...initialPost, content: 'Remote edit', version: 1 }));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(mocks.updatePost).toHaveBeenCalledWith('post-1', expect.objectContaining({ expectedVersion: 0 }));
    expect(await screen.findByRole('button', { name: 'Tải phiên bản mới' })).toBeVisible();
  });

  it('keeps the delete confirmation base version across refresh', async () => {
    const user = userEvent.setup();
    mocks.deletePost.mockRejectedValue(new PostsApiError('Conflict', 409, 'POST_CONFLICT'));
    const renderCard = (post: PostView) => <MemoryRouter><PostCard post={post} onUpdated={vi.fn()} onDeleted={vi.fn()} /></MemoryRouter>;
    const view = render(renderCard(initialPost));
    await user.click(screen.getByRole('button', { name: 'Xóa bài viết' }));
    view.rerender(renderCard({ ...initialPost, version: 1 }));
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    expect(mocks.deletePost).toHaveBeenCalledWith('post-1', 0);
  });
  it('renders content as literal text and exposes owner actions without relying on hover', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/u)).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Xem bài viết đầy đủ' })).toHaveAttribute('href', '/bai-viet/post-1');
    expect(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Xóa bài viết' })).toBeVisible();
  });

  it('submits an owner edit with expectedVersion and updates the displayed Post', async () => {
    const user = userEvent.setup();
    mocks.updatePost.mockResolvedValue({ ...initialPost, content: 'Nội dung mới', version: 1 });
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.type(editor, 'Nội dung mới');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(mocks.updatePost).toHaveBeenCalledWith('post-1', { content: 'Nội dung mới', expectedVersion: 0 });
    expect(await screen.findByText('Nội dung mới')).toBeVisible();
    expect(screen.getByText('Đã chỉnh sửa')).toBeVisible();
  });

  it('disables the editor and announces saving until the submitted draft is resolved', async () => {
    const user = userEvent.setup();
    let completeSave!: (post: PostView) => void;
    mocks.updatePost.mockImplementation(() => new Promise((resolve) => { completeSave = resolve; }));
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.type(editor, 'Submitted draft');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(editor).toBeDisabled();
    expect(await screen.findByRole('status')).toHaveTextContent('Đang lưu…');
    completeSave({ ...initialPost, content: 'Submitted draft', version: 1 });
    await waitFor(() => expect(screen.getByText('Submitted draft')).toBeVisible());
  });

  it('announces inline editor validation and associates the error with the field', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Vui lòng nhập nội dung bài viết.');
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor.getAttribute('aria-describedby')?.split(' ')).toContain(error.querySelector('[id]')?.id);
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it('retains the draft on a version conflict and only retries after loading the latest version', async () => {
    const user = userEvent.setup();
    mocks.updatePost.mockRejectedValueOnce(new PostsApiError('Conflict', 409, 'POST_CONFLICT'))
      .mockResolvedValueOnce({ ...initialPost, content: 'Bản nháp được lưu', version: 2 });
    mocks.getPost.mockResolvedValue({ ...initialPost, content: 'Nội dung của phiên bản mới', version: 1 });
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.type(editor, 'Bản nháp được lưu');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Bản nháp vẫn được giữ. Tải phiên bản mới trước khi lưu tiếp.');
    expect(editor).toHaveValue('Bản nháp được lưu');

    await user.click(screen.getByRole('button', { name: 'Tải phiên bản mới' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã tải phiên bản mới');
    expect(screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' })).toHaveValue('Bản nháp được lưu');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(mocks.updatePost).toHaveBeenLastCalledWith('post-1', { content: 'Bản nháp được lưu', expectedVersion: 1 });
  });

  it('removes a stale card when an edit race reports that the Post was deleted', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    mocks.updatePost.mockRejectedValue(new PostsApiError('Post not found', 404, 'POST_NOT_FOUND'));
    render(<MemoryRouter><Harness onDeleted={onDeleted} /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('post-1'));
  });

  it('requires confirmation for permanent deletion and restores focus when cancelled', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Xóa bài viết' });
    await user.click(trigger);
    const confirmation = screen.getByRole('group', { name: 'Xác nhận xóa bài viết vĩnh viễn' });
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveTextContent('không thể khôi phục');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    mocks.deletePost.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    expect(mocks.deletePost).toHaveBeenCalledWith('post-1', 0);
  });
});
