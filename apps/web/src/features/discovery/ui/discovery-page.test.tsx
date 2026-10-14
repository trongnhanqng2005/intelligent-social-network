import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMembers, type MemberDirectoryPage, type PublicProfile } from '../../profile/api/profile-api';
import { DiscoveryPage } from './discovery-page';

vi.mock('../../profile/api/profile-api', () => ({ listMembers: vi.fn() }));

const first: PublicProfile = {
  id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'Nguyễn An', bio: 'Xin chào.', location: 'Đà Nẵng',
};
const second: PublicProfile = {
  id: 'f4ce1c82-8f40-49aa-82c8-f0515878888a', displayName: 'Đặng Bình', bio: null, location: null,
};

function page(items: PublicProfile[], hasMore = false, nextCursor: string | null = null): MemberDirectoryPage {
  return { items, pagination: { limit: 20, hasMore, nextCursor } };
}

function LocationText() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function HistoryControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>Browser back</button><button onClick={() => navigate(1)}>Browser forward</button></>;
}

function renderDiscovery(path = '/kham-pha') {
  return render(<MemoryRouter initialEntries={[path]}><HistoryControls /><LocationText /><DiscoveryPage /></MemoryRouter>);
}

beforeEach(() => vi.mocked(listMembers).mockReset().mockResolvedValue(page([])));
afterEach(cleanup);

describe('DiscoveryPage', () => {
  it('submits an explicit accent-preserving search and shows an actionable no-match state', async () => {
    const user = userEvent.setup();
    renderDiscovery();
    await screen.findByText('Chưa có thành viên để hiển thị.');
    vi.mocked(listMembers).mockResolvedValueOnce(page([]));
    await user.type(screen.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' }), 'Nguyễn');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Chưa tìm thấy thành viên phù hợp.')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/kham-pha?q=Nguy%E1%BB%85n');
    expect(listMembers).toHaveBeenLastCalledWith({ q: 'Nguyễn' }, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Xem tất cả thành viên' })).toBeVisible();
  });

  it('preserves query state while navigating next and previous cursor pages', async () => {
    const user = userEvent.setup();
    vi.mocked(listMembers).mockImplementation(async (input = {}) => input.cursor === 'cursor-one'
      ? page([second])
      : page([first], true, 'cursor-one'));
    renderDiscovery('/kham-pha?q=nguyen');
    expect(await screen.findByRole('link', { name: 'Nguyễn An' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Trang tiếp/ }));
    expect(await screen.findByRole('link', { name: 'Đặng Bình' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/kham-pha?q=nguyen&cursor=cursor-one');
    await user.click(screen.getByRole('button', { name: /Trang trước/ }));
    expect(await screen.findByRole('link', { name: 'Nguyễn An' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/kham-pha?q=nguyen');
  });

  it('keeps previous-page controls synchronized with browser back and forward', async () => {
    const user = userEvent.setup();
    vi.mocked(listMembers).mockImplementation(async (input = {}) => input.cursor === 'cursor-one'
      ? page([second])
      : page([first], true, 'cursor-one'));
    renderDiscovery();
    expect(await screen.findByRole('link', { name: 'Nguyễn An' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Trang tiếp/ }));
    expect(await screen.findByRole('link', { name: 'Đặng Bình' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByRole('link', { name: 'Nguyễn An' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Trang trước/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Browser forward' }));
    expect(await screen.findByRole('link', { name: 'Đặng Bình' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Trang trước/ })).toBeEnabled();
  });

  it('suppresses a stale response when the previous request ignores cancellation', async () => {
    const user = userEvent.setup();
    vi.mocked(listMembers).mockImplementation((input = {}) => input.q
      ? Promise.resolve(page([second]))
      : new Promise((resolve) => window.setTimeout(() => resolve(page([first])), 25)));
    renderDiscovery();
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(1));
    const input = screen.getByRole('searchbox', { name: 'Tìm theo tên hiển thị' });
    await user.type(input, 'Đặng');
    await user.click(screen.getByRole('button', { name: /Tìm kiếm/ }));
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    expect(listMembers).toHaveBeenLastCalledWith({ q: 'Đặng' }, expect.any(AbortSignal));
    expect(await screen.findByRole('link', { name: 'Đặng Bình' })).toBeVisible();
    expect((vi.mocked(listMembers).mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(screen.queryByRole('link', { name: 'Nguyễn An' })).not.toBeInTheDocument();
  });
});
