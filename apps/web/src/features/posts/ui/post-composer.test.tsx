import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostsApiError } from '../api/posts-api';

const mocks = vi.hoisted(() => ({ createPost: vi.fn() }));
vi.mock('../api/posts-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/posts-api')>(),
  createPost: mocks.createPost,
}));
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ retry: vi.fn() }) }));

import { PostComposer } from './post-composer';

beforeEach(() => mocks.createPost.mockReset());
afterEach(cleanup);

describe('PostComposer', () => {
  it('counts normalized Unicode code points and creates a friends-only plain-text Post by default', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mocks.createPost.mockResolvedValue({ id: 'post-1' });
    render(<PostComposer onCreated={onCreated} onRefreshFeed={vi.fn()} />);

    const content = screen.getByRole('textbox', { name: 'Nội dung bài viết' });
    await user.type(content, '👨‍👩‍👧‍👦');
    expect(screen.getByText('7/2.000 ký tự')).toBeVisible();
    expect(screen.getByLabelText('Ai có thể xem?')).toHaveValue('friends');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));

    expect(mocks.createPost).toHaveBeenCalledWith({ content: '👨‍👩‍👧‍👦', visibility: 'friends' });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(content).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Bài viết đã được đăng.');
  });

  it('requires visible content and prevents over-limit normalized code-point submissions', async () => {
    const user = userEvent.setup();
    render(<PostComposer onCreated={vi.fn()} onRefreshFeed={vi.fn()} />);
    const content = screen.getByRole('textbox', { name: 'Nội dung bài viết' });
    fireEvent.change(content, { target: { value: '🌱'.repeat(2001) } });
    expect(screen.getByText('2.001/2.000 ký tự')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('keeps an uncertain create draft blocked until the user completes reconciliation', async () => {
    const user = userEvent.setup();
    let finishRefresh!: (success: boolean) => void;
    const onRefreshFeed = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishRefresh = resolve; }))
      .mockResolvedValueOnce(true);
    mocks.createPost.mockRejectedValueOnce(new PostsApiError('Outcome unknown', 503, 'WRITE_OUTCOME_UNKNOWN'))
      .mockResolvedValueOnce({ id: 'post-1' });
    render(<PostComposer onCreated={vi.fn()} onRefreshFeed={onRefreshFeed} />);

    const content = screen.getByRole('textbox', { name: 'Nội dung bài viết' });
    await user.type(content, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không gửi lại tự động');
    expect(content).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Đăng bài' })).toBeDisabled();

    fireEvent.submit(content.closest('form')!);
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    const refreshButton = screen.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' });
    await user.click(refreshButton);
    expect(onRefreshFeed).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).not.toBeInTheDocument();
    finishRefresh(false);
    expect(await screen.findByText('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Đăng bài' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tải lại bảng tin để kiểm tra' }));
    expect(await screen.findByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tôi đã kiểm tra, cho phép gửi lại' }));
    expect(screen.getByRole('button', { name: 'Đăng bài' })).toBeEnabled();
    expect(content).toHaveValue('Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Đăng bài' }));
    expect(mocks.createPost).toHaveBeenCalledTimes(2);
    expect(content).toHaveValue('');
  });

});
