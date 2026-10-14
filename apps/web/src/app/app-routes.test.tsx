import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
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
    expect(screen.getByRole('status')).toHaveTextContent('Đang kiểm tra phiên');
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
