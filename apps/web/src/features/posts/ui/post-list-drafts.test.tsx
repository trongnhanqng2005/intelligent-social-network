import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AuthApiError } from '../../auth/api/auth-api';
import { AuthProvider, useAuth } from '../../auth/model/auth-context';
import type { PostsPage, PostView } from '../api/posts-api';
import { PostList } from './post-list';

const mocks = vi.hoisted(() => ({ restoreSession: vi.fn() }));
vi.mock('../../auth/api/auth-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../auth/api/auth-api')>(),
  restoreSession: mocks.restoreSession,
}));

const post: PostView = {
  id: '33333333-3333-4333-8333-333333333333',
  content: 'Original Post',
  visibility: 'friends',
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
  version: 0,
  author: { id: 'viewer', displayName: 'Thành viên', bio: null, location: null },
  permissions: { canEdit: true, canDelete: true },
};
const page: PostsPage = { items: [post], pagination: { limit: 20, hasMore: false, nextCursor: null } };
const session = {
  user: { id: 'viewer', email: 'viewer@example.invalid' },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function ProtectedPostList({ loadPage }: { loadPage(): Promise<PostsPage> }) {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <p>Protected state cleared</p>;
  return <PostList loadPage={loadPage} refreshKey={0} />;
}

afterEach(cleanup);

describe('PostList session revalidation', () => {
  it('preserves an editing draft during focus refresh and clears protected state after revocation', async () => {
    let finishRevalidation!: (value: typeof session) => void;
    mocks.restoreSession.mockReset()
      .mockResolvedValueOnce(session)
      .mockImplementationOnce(() => new Promise((resolve) => { finishRevalidation = resolve; }))
      .mockRejectedValueOnce(new AuthApiError('Revoked', 401));
    const loadPage = vi.fn().mockResolvedValue(page);
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><ProtectedPostList loadPage={loadPage} /></AuthProvider></MemoryRouter>);
    await screen.findByText('Original Post');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa bài viết' }));
    const editor = screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' });
    await user.clear(editor);
    await user.type(editor, 'Unsaved draft');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.restoreSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' })).toHaveValue('Unsaved draft');
    finishRevalidation(session);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' })).toHaveValue('Unsaved draft'));

    fireEvent.focus(window);
    await waitFor(() => expect(mocks.restoreSession).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Protected state cleared')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Chỉnh sửa nội dung bài viết' })).not.toBeInTheDocument();
  });
});
