import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOwnProfile, updateOwnProfile, UserApiError, type OwnProfile } from '../api/profile-api';
import { ProfilePage } from './profile-page';

vi.mock('../api/profile-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/profile-api')>();
  return { ...actual, getOwnProfile: vi.fn(), updateOwnProfile: vi.fn() };
});

const profile: OwnProfile = {
  id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'Nguyễn An',
  bio: 'Mình thích đọc sách.', location: 'Đà Nẵng',
  createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', version: 0,
};

beforeEach(() => {
  vi.mocked(getOwnProfile).mockReset().mockResolvedValue(profile);
  vi.mocked(updateOwnProfile).mockReset();
});
afterEach(cleanup);

describe('ProfilePage', () => {
  it('loads a member-visible profile, enters edit mode and cancels the draft', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    expect(await screen.findByText('Mình thích đọc sách.')).toBeVisible();
    expect(screen.getByText('NA')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
    const name = screen.getByLabelText('Tên hiển thị');
    await user.clear(name);
    await user.type(name, 'Tên nháp');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByLabelText('Tên hiển thị')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nguyễn An' })).toBeVisible();
  });

  it('saves an edit with the last server version and announces success', async () => {
    const user = userEvent.setup();
    vi.mocked(updateOwnProfile).mockResolvedValue({ ...profile, displayName: 'Minh An', version: 1 });
    render(<ProfilePage />);
    await screen.findByText('Mình thích đọc sách.');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
    await user.clear(screen.getByLabelText('Tên hiển thị'));
    await user.type(screen.getByLabelText('Tên hiển thị'), 'Minh An');
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Hồ sơ đã được lưu.');
    expect(updateOwnProfile).toHaveBeenCalledWith({
      displayName: 'Minh An', bio: 'Mình thích đọc sách.', location: 'Đà Nẵng', expectedVersion: 0,
    });
  });

  it('preserves a conflict draft, reloads the latest version, and lets the member save it manually', async () => {
    const user = userEvent.setup();
    vi.mocked(getOwnProfile).mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, displayName: 'Tên mới từ máy khác', version: 1 });
    vi.mocked(updateOwnProfile)
      .mockRejectedValueOnce(new UserApiError('Conflict', 409, 'PROFILE_CONFLICT'))
      .mockResolvedValueOnce({ ...profile, displayName: 'Tên bản nháp', version: 2 });
    render(<ProfilePage />);
    await screen.findByText('Mình thích đọc sách.');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
    const name = screen.getByLabelText('Tên hiển thị');
    await user.clear(name);
    await user.type(name, 'Tên bản nháp');
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/bản nháp của bạn vẫn được giữ lại/i);
    expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Tên bản nháp');

    await user.click(screen.getByRole('button', { name: 'Tải phiên bản mới' }));
    await waitFor(() => expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Tên bản nháp'));
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    await waitFor(() => expect(updateOwnProfile).toHaveBeenCalledTimes(2));
    expect(updateOwnProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      displayName: 'Tên bản nháp', expectedVersion: 1,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Hồ sơ đã được lưu.');
  });

  it('uses code-point validation and focuses the error summary without truncation', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByText('Mình thích đọc sách.');
    await user.click(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
    const name = screen.getByLabelText('Tên hiển thị');
    await user.clear(name);
    await user.type(name, '😀');
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });
});
