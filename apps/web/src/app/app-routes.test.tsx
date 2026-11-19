import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './app-routes';

const fetchMock = vi.fn<typeof fetch>();

function response(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(response(401, { error: { code: 'UNAUTHENTICATED' } }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><CurrentLocation /><AppRoutes /></MemoryRouter>);
}

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

describe('application routes', () => {
  it('renders the Vietnamese community home page for anonymous visitors', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kết nối có ý nghĩa, bắt đầu từ bạn.' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Tạo tài khoản' }).every((link) => link.getAttribute('href') === '/dang-ky')).toBe(true);
    expect(screen.getByRole('link', { name: 'Tìm hiểu thêm' })).toHaveAttribute('href', '#gioi-thieu');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/health');
    expect(screen.queryByText(/đang trong giai đoạn phát triển/i)).not.toBeInTheDocument();
  });

  it('does not show anonymous account invitations while restoring a session', () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => undefined));
    renderAt('/');
    expect(screen.queryByRole('link', { name: 'Đăng nhập' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tạo tài khoản' })).not.toBeInTheDocument();
    expect(screen.getByText('Đang kiểm tra phiên…')).toBeVisible();
  });

  it('does not show login or registration links to an authenticated visitor', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      user: { id: 'user-1', email: 'an@example.test' },
      session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    }));
    renderAt('/');

    expect(await screen.findByText('an@example.test')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Đăng nhập' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tạo tài khoản' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hồ sơ của tôi' })).toHaveAttribute('href', '/ho-so');
    expect(screen.getByRole('link', { name: 'Khám phá' })).toHaveAttribute('href', '/kham-pha');
    expect(screen.getByRole('link', { name: 'Bảng tin' })).toHaveAttribute('href', '/bang-tin');
  });

  it('protects member routes and preserves a local return destination for login', async () => {
    renderAt('/ho-so?tab=gioi-thieu');
    expect(await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/dang-nhap?returnTo=%2Fho-so%3Ftab%3Dgioi-thieu',
    );
  });

  it.each(['/bang-tin', '/bai-viet/22222222-2222-4222-8222-222222222222'])(
    'protects the authenticated Posts route %s and preserves it for login', async (path) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
      expect(screen.getByTestId('current-location')).toHaveTextContent(
        `/dang-nhap?returnTo=${encodeURIComponent(path)}`,
      );
    },
  );

  it('does not interpret an unavailable session check as an anonymous session', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    renderAt('/kham-pha');
    expect(await screen.findByRole('heading', { name: 'Chưa thể xác minh phiên' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Chào mừng bạn trở lại' })).not.toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/kham-pha');
  });

  it('loads the authenticated member profile through the protected route', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, {
        user: { id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', email: 'an@example.test' },
        session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      }))
      .mockResolvedValueOnce(response(200, { profile: {
        id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'Nguyễn An', bio: null, location: null,
        createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', version: 0,
      } }));
    renderAt('/ho-so');
    expect(await screen.findByText('Nguyễn An')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Hồ sơ của tôi' })).toBeVisible();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/users/me/profile');
  });

  it('returns to the protected local destination after a successful login', async () => {
    const user = userEvent.setup();
    renderAt('/dang-nhap?returnTo=%2Fho-so');
    await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' });
    fetchMock
      .mockResolvedValueOnce(response(200, { csrfToken: 'anonymous-csrf' }))
      .mockResolvedValueOnce(response(200, {
        user: { id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', email: 'an@example.test' },
        session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      }))
      .mockResolvedValueOnce(response(200, { profile: {
        id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'Nguyễn An', bio: null, location: null,
        createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', version: 0,
      } }));
    await user.type(screen.getByRole('textbox', { name: 'Địa chỉ email' }), 'an@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: /Đăng nhập/ }));
    expect(await screen.findByText('Nguyễn An')).toBeVisible();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/ho-so');
  });

  it('shows only the member-visible profile projection and links back to discovery', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, {
        user: { id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', email: 'an@example.test' },
        session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      }))
      .mockResolvedValueOnce(response(200, { profile: {
        id: 'f4ce1c82-8f40-49aa-82c8-f0515878888a', displayName: 'Đặng Bình', bio: 'Xin chào.', location: 'Huế',
      } }));
    renderAt('/thanh-vien/f4ce1c82-8f40-49aa-82c8-f0515878888a');
    expect(await screen.findByRole('heading', { name: 'Hồ sơ thành viên' })).toBeVisible();
    expect(screen.getByText('Xin chào.')).toBeVisible();
    expect(screen.getByRole('link', { name: /Quay lại khám phá/ })).toHaveAttribute('href', '/kham-pha');
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa hồ sơ' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/users/f4ce1c82-8f40-49aa-82c8-f0515878888a/profile');
  });

  it('redirects the current member UUID to their own profile', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, {
        user: { id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', email: 'an@example.test' },
        session: { expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      }))
      .mockResolvedValueOnce(response(200, { profile: {
        id: 'd723b01f-7048-4efd-80c7-2d59cfb88319', displayName: 'Nguyễn An', bio: null, location: null,
        createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', version: 0,
      } }));
    renderAt('/thanh-vien/d723b01f-7048-4efd-80c7-2d59cfb88319');
    expect(await screen.findByText('Nguyễn An')).toBeVisible();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/ho-so');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/users/d723b01f-7048-4efd-80c7-2d59cfb88319/profile');
  });

  it('renders accessible login and registration forms', async () => {
    renderAt('/dang-nhap');
    expect(await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Weylume — Trang chủ' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Địa chỉ email' })).toBeVisible();
    expect(screen.getByLabelText('Mật khẩu')).toBeVisible();

    cleanup();
    fetchMock.mockResolvedValue(response(401, { error: { code: 'UNAUTHENTICATED' } }));
    renderAt('/dang-ky');
    expect(await screen.findByRole('heading', { name: 'Tạo tài khoản mới' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Tạo tài khoản/ })).toBeEnabled();
  });

  it('renders a not-found page for unknown routes', async () => {
    renderAt('/unrecognized');
    expect(await screen.findByRole('heading', { level: 1, name: 'Trang này chưa có ở đây.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Quay về trang chủ' })).toHaveAttribute('href', '/');
  });
});
