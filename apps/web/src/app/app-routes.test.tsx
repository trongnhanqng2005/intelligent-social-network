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
    expect(await screen.findByRole('heading', { level: 1, name: 'Kết nối bắt đầu từ những điều giản dị.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Tạo tài khoản' })).toHaveAttribute('href', '/dang-ky');
  });

  it('renders accessible login and registration forms', async () => {
    renderAt('/dang-nhap');
    expect(await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' })).toBeVisible();
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeVisible();
  });
});
