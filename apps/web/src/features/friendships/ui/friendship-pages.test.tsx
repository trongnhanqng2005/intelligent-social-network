import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import {
  actOnFriendshipRequest,
  listFriendshipRequests,
  listFriendships,
  unfriend,
  type FriendshipListItem,
  type FriendshipPage,
  type FriendshipRequestListItem,
} from '../api/friendships-api';
import { FriendsPage } from './friends-page';
import { FriendshipRequestsPage } from './friendship-requests-page';

const retry = vi.fn();
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ retry }) }));
vi.mock('../api/friendships-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/friendships-api')>();
  return {
    ...actual,
    actOnFriendshipRequest: vi.fn(),
    listFriendshipRequests: vi.fn(),
    listFriendships: vi.fn(),
    unfriend: vi.fn(),
  };
});

const memberId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const friendshipId = '44444444-4444-4444-8444-444444444444';
const member = { id: memberId, displayName: 'Nguyễn Bình', bio: 'Xin chào.', location: 'Huế' };
const friendItem: FriendshipListItem = { friendshipId, friendsSince: '2026-10-14T10:00:00.000Z', member };
const requestItem: FriendshipRequestListItem = {
  request: {
    id: requestId, senderId: memberId, recipientId: '11111111-1111-4111-8111-111111111111',
    status: 'PENDING', createdAt: '2026-10-14T10:00:00.000Z', resolvedAt: null,
  },
  member,
};
const secondMember = { ...member, id: '55555555-5555-4555-8555-555555555555', displayName: 'Trần An' };
const secondFriendItem: FriendshipListItem = {
  friendshipId: '66666666-6666-4666-8666-666666666666',
  friendsSince: '2026-10-14T10:00:00.000Z',
  member: secondMember,
};
const secondRequestItem: FriendshipRequestListItem = {
  ...requestItem,
  request: { ...requestItem.request, id: '77777777-7777-4777-8777-777777777777' },
  member: secondMember,
};

function page<T>(items: T[], pagination: FriendshipPage<T>['pagination'] = { limit: 20, hasMore: false, nextCursor: null }): FriendshipPage<T> {
  return { items, pagination };
}

function LocationText() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  retry.mockReset();
  vi.mocked(listFriendships).mockReset().mockResolvedValue(page([friendItem]));
  vi.mocked(listFriendshipRequests).mockReset().mockResolvedValue(page([requestItem]));
  vi.mocked(actOnFriendshipRequest).mockReset().mockResolvedValue({
    request: { ...requestItem.request, status: 'ACCEPTED', resolvedAt: 'later' },
    relationship: { memberId, state: 'friends', requestId: null, friendshipId, friendsSince: 'later' },
  });
  vi.mocked(unfriend).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('friendship list pages', () => {
  it('renders friends, opens an inline confirmation and removes only after unfriend succeeds', async () => {
    const user = userEvent.setup();
    vi.mocked(listFriendships)
      .mockResolvedValueOnce(page([friendItem]))
      .mockResolvedValueOnce(page([]));
    render(<MemoryRouter initialEntries={['/ban-be']}>
      <LocationText /><FriendsPage />
    </MemoryRouter>);

    const memberLink = await screen.findByRole('link', { name: 'Nguyễn Bình' });
    expect(memberLink).toHaveAttribute('href', `/thanh-vien/${memberId}`);
    await user.click(memberLink);
    expect(screen.getByTestId('current-location')).toHaveTextContent(`/thanh-vien/${memberId}`);
    cleanup();

    vi.mocked(listFriendships).mockReset()
      .mockResolvedValueOnce(page([friendItem]))
      .mockResolvedValueOnce(page([]));
    render(<MemoryRouter initialEntries={['/ban-be']}><FriendsPage /></MemoryRouter>);
    await screen.findByRole('link', { name: 'Nguyễn Bình' });
    await user.click(screen.getByRole('button', { name: /Hủy kết bạn/ }));
    const confirmation = screen.getByRole('group', { name: `Xác nhận hủy kết bạn với ${member.displayName}` });
    expect(confirmation).toBeVisible();
    expect(confirmation).toHaveFocus();
    expect(unfriend).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Giữ kết bạn' }));
    const trigger = screen.getByRole('button', { name: /Hủy kết bạn/ });
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole('group', { name: `Xác nhận hủy kết bạn với ${member.displayName}` })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));
    await waitFor(() => expect(unfriend).toHaveBeenCalledWith(friendshipId));
    expect(await screen.findByText(`Đã hủy kết bạn với ${member.displayName}.`)).toBeVisible();
    expect(await screen.findByText('Bạn chưa có bạn bè.')).toBeVisible();
  });

  it('shows an empty incoming state without inventing friendship data', async () => {
    vi.mocked(listFriendshipRequests).mockResolvedValue(page([]));
    render(<MemoryRouter initialEntries={['/ban-be/loi-moi?direction=received']}><FriendshipRequestsPage /></MemoryRouter>);
    expect(await screen.findByText('Bạn chưa có lời mời kết bạn.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Chấp nhận' })).not.toBeInTheDocument();
  });

  it('keeps previous-page navigation when removing the last friend from a later page', async () => {
    const user = userEvent.setup();
    vi.mocked(listFriendships).mockReset()
      .mockResolvedValueOnce(page([friendItem], { limit: 1, hasMore: true, nextCursor: 'cursor-page-2' }))
      .mockResolvedValueOnce(page([secondFriendItem], { limit: 1, hasMore: false, nextCursor: null }))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([friendItem], { limit: 1, hasMore: true, nextCursor: 'cursor-page-2' }));
    render(<MemoryRouter initialEntries={['/ban-be']}><FriendsPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Trang tiếp' }));
    await screen.findByRole('link', { name: secondMember.displayName });
    await user.click(screen.getByRole('button', { name: /Hủy kết bạn/ }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận hủy' }));

    expect(await screen.findByText('Trang này hiện không có bạn bè.')).toBeVisible();
    const previous = screen.getByRole('button', { name: 'Trang trước' });
    expect(previous).toBeEnabled();
    await user.click(previous);
    expect(await screen.findByRole('link', { name: member.displayName })).toBeVisible();
  });

  it('keeps previous-page navigation when resolving the last request from a later page', async () => {
    const user = userEvent.setup();
    vi.mocked(listFriendshipRequests).mockReset()
      .mockResolvedValueOnce(page([requestItem], { limit: 1, hasMore: true, nextCursor: 'cursor-page-2' }))
      .mockResolvedValueOnce(page([secondRequestItem], { limit: 1, hasMore: false, nextCursor: null }))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([requestItem], { limit: 1, hasMore: true, nextCursor: 'cursor-page-2' }));
    render(<MemoryRouter initialEntries={['/ban-be/loi-moi?direction=received']}><FriendshipRequestsPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Trang tiếp' }));
    await screen.findByRole('link', { name: secondMember.displayName });
    await user.click(screen.getByRole('button', { name: 'Chấp nhận' }));

    expect(await screen.findByText('Trang này hiện không có lời mời.')).toBeVisible();
    const previous = screen.getByRole('button', { name: 'Trang trước' });
    expect(previous).toBeEnabled();
    await user.click(previous);
    expect(await screen.findByRole('link', { name: member.displayName })).toBeVisible();
  });

  it('accepts a received request, announces the result and reconciles the list', async () => {
    const user = userEvent.setup();
    vi.mocked(listFriendshipRequests)
      .mockResolvedValueOnce(page([requestItem]))
      .mockResolvedValueOnce(page([]));
    render(<MemoryRouter initialEntries={['/ban-be/loi-moi?direction=received']}>
      <LocationText /><FriendshipRequestsPage />
    </MemoryRouter>);
    expect(await screen.findByText('Đã gửi lời mời cho bạn · 14/10/2026')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Chấp nhận' }));
    await waitFor(() => expect(actOnFriendshipRequest).toHaveBeenCalledWith(requestId, 'accept'));
    expect(await screen.findByText(`Bạn và ${member.displayName} đã trở thành bạn bè.`)).toBeVisible();
    expect(await screen.findByText('Bạn chưa có lời mời kết bạn.')).toBeVisible();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/ban-be/loi-moi?direction=received');
  });

  it('shows only outgoing cancellation on the sent list', async () => {
    const user = userEvent.setup();
    vi.mocked(listFriendshipRequests).mockResolvedValue(page([requestItem]));
    render(<MemoryRouter initialEntries={['/ban-be/loi-moi?direction=sent']}><FriendshipRequestsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Lời mời đã gửi' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hủy lời mời' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Chấp nhận' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hủy lời mời' }));
    expect(actOnFriendshipRequest).toHaveBeenCalledWith(requestId, 'cancel');
  });
});
