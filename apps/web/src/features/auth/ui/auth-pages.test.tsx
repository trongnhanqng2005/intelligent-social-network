import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../../app/app-routes';

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

describe('authentication pages', () => {
  it('performs a CSRF-protected login and shows the restored authenticated state', async () => {
    const user = userEvent.setup();
    renderAt('/dang-nhap');
    await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' });

    fetchMock
      .mockResolvedValueOnce(response(200, { csrfToken: 'anonymous-csrf' }))
      .mockResolvedValueOnce(response(200, {
        user: { id: 'user-1', email: 'an@example.test' },
        session: { expiresAt: '2026-10-14T12:00:00.000Z' },
        csrfToken: 'session-csrf',
      }));

    await user.type(screen.getByRole('textbox', { name: 'Địa chỉ email' }), 'an@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: /Đăng nhập/ }));

    expect(await screen.findByRole('heading', { name: /Chào mừng trở lại/ })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'anonymous-csrf' }),
    }));
  });

  it('shows safe validation errors and does not retry a CSRF-failed mutation automatically', async () => {
    const user = userEvent.setup();
    renderAt('/dang-ky');
    await screen.findByRole('heading', { name: 'Tạo tài khoản mới' });
    fetchMock
      .mockResolvedValueOnce(response(200, { csrfToken: 'stale-token' }))
      .mockResolvedValueOnce(response(403, { error: { code: 'CSRF_FAILED', message: 'Thông tin xác minh không còn hợp lệ.' } }));

    await user.type(screen.getByRole('textbox', { name: 'Địa chỉ email' }), 'an@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: /Tạo tài khoản/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Phiên xác minh đã thay đổi. Vui lòng gửi lại biểu mẫu.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('provides an accessible password visibility toggle', async () => {
    const user = userEvent.setup();
    renderAt('/dang-nhap');
    await screen.findByRole('heading', { name: 'Chào mừng bạn trở lại' });
    const password = screen.getByLabelText('Mật khẩu');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(password).toHaveAttribute('type', 'text');
  });

  it.each(['/dang-ky', '/dang-nhap'])('does not truncate supplementary-character passwords on %s', async (path) => {
    const user = userEvent.setup();
    renderAt(path);
    const password = await screen.findByLabelText('Mật khẩu');
    const value = '🔐'.repeat(100);
    await user.type(password, value);
    expect(password).toHaveValue(value);
  });
});
