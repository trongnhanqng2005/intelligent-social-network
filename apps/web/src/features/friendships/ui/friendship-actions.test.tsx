import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actOnFriendshipRequest,
  createFriendshipRequest,
  FriendshipApiError,
  getFriendshipRelationship,
  unfriend,
  type FriendshipRelationship,
} from '../api/friendships-api';
import { FriendshipActions } from './friendship-actions';

const retry = vi.fn();
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ retry }) }));
vi.mock('../api/friendships-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/friendships-api')>();
  return {
    ...actual,
    actOnFriendshipRequest: vi.fn(),
    createFriendshipRequest: vi.fn(),
    getFriendshipRelationship: vi.fn(),
    unfriend: vi.fn(),
  };
});

const memberId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const friendshipId = '44444444-4444-4444-8444-444444444444';
const none: FriendshipRelationship = {
  memberId, state: 'none', requestId: null, friendshipId: null, friendsSince: null,
};
const outgoing: FriendshipRelationship = {
  ...none, state: 'outgoing_pending', requestId,
};

beforeEach(() => {
  vi.mocked(getFriendshipRelationship).mockReset().mockResolvedValue(none);
  vi.mocked(createFriendshipRequest).mockReset().mockResolvedValue({
    request: {
      id: requestId, senderId: '11111111-1111-4111-8111-111111111111', recipientId: memberId,
      status: 'PENDING', createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
    },
    relationship: outgoing,
  });
  vi.mocked(actOnFriendshipRequest).mockReset();
  vi.mocked(unfriend).mockReset().mockResolvedValue(undefined);
  retry.mockReset();
});
afterEach(cleanup);

describe('FriendshipActions', () => {
  it('loads a neutral state and only reports send success after the API resolves', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: Awaited<ReturnType<typeof createFriendshipRequest>>) => void;
    vi.mocked(createFriendshipRequest).mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<FriendshipActions memberId={memberId} />);
    await user.click(await screen.findByRole('button', { name: 'Kết bạn' }));
    expect(screen.getByRole('button', { name: /Đang gửi lời mời/ })).toBeDisabled();
    expect(screen.queryByText('Đã gửi lời mời kết bạn.')).not.toBeInTheDocument();
    resolveRequest({
      request: {
        id: requestId, senderId: '11111111-1111-4111-8111-111111111111', recipientId: memberId,
        status: 'PENDING', createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
      },
      relationship: outgoing,
    });
    expect(await screen.findByText('Đã gửi lời mời kết bạn.')).toBeVisible();
    expect(screen.getByText('Đã gửi lời mời kết bạn', { selector: 'p' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Kết nối' })).toHaveFocus();
  });

  it('accepts an incoming request and updates from the server result', async () => {
    const user = userEvent.setup();
    vi.mocked(getFriendshipRelationship).mockResolvedValueOnce({ ...none, state: 'incoming_pending', requestId });
    vi.mocked(actOnFriendshipRequest).mockResolvedValueOnce({
      request: {
        id: requestId, senderId: memberId, recipientId: '11111111-1111-4111-8111-111111111111',
        status: 'ACCEPTED', createdAt: 'now', resolvedAt: 'then',
      },
      relationship: { ...none, state: 'friends', friendshipId, friendsSince: 'then' },
    });
    render(<FriendshipActions memberId={memberId} />);
    await user.click(await screen.findByRole('button', { name: /Chấp nhận/ }));
    expect(await screen.findByText('Hai bạn đã trở thành bạn bè.')).toBeVisible();
    expect(actOnFriendshipRequest).toHaveBeenCalledWith(requestId, 'accept');
    expect(screen.getByText('Hai bạn là bạn bè.')).toBeVisible();
  });

  it('requires an explicit accessible confirmation before unfriending', async () => {
    const user = userEvent.setup();
    vi.mocked(getFriendshipRelationship).mockResolvedValueOnce({
      ...none, state: 'friends', friendshipId, friendsSince: 'then',
    });
    vi.mocked(getFriendshipRelationship).mockResolvedValueOnce(none);
    render(<FriendshipActions memberId={memberId} />);
    await user.click(await screen.findByRole('button', { name: /Hủy kết bạn/ }));
    const confirmation = screen.getByRole('group', { name: 'Xác nhận hủy kết bạn' });
    expect(confirmation).toBeVisible();
    expect(confirmation).toHaveFocus();
    expect(unfriend).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Giữ kết bạn' }));
    const trigger = screen.getByRole('button', { name: /Hủy kết bạn/ });
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'Xác nhận hủy kết bạn' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(unfriend).toHaveBeenCalledWith(friendshipId));
    expect(await screen.findByText('Đã hủy kết bạn.')).toBeVisible();
  });

  it('refetches after a conflict and keeps actions disabled when initial status fails', async () => {
    const user = userEvent.setup();
    vi.mocked(getFriendshipRelationship)
      .mockResolvedValueOnce(none)
      .mockResolvedValueOnce({ ...none, state: 'incoming_pending', requestId });
    vi.mocked(createFriendshipRequest).mockRejectedValueOnce(
      new FriendshipApiError('Bạn đã nhận lời mời từ thành viên này.', 409, 'INCOMING_REQUEST_EXISTS'),
    );
    const { rerender } = render(<FriendshipActions memberId={memberId} />);
    await user.click(await screen.findByRole('button', { name: 'Kết bạn' }));
    expect(await screen.findByText(/đã nhận lời mời/i)).toBeVisible();
    await waitFor(() => expect(getFriendshipRelationship).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Chấp nhận' })).toBeVisible();

    vi.mocked(getFriendshipRelationship).mockRejectedValueOnce(new Error('offline'));
    rerender(<FriendshipActions memberId="55555555-5555-4555-8555-555555555555" />);
    const retryButton = await screen.findByRole('button', { name: 'Thử tải lại' });
    expect(retryButton).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kết bạn' })).not.toBeInTheDocument();
    await user.click(retryButton);
    expect(await screen.findByRole('button', { name: 'Kết bạn' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Kết nối' })).toHaveFocus();
  });
});
