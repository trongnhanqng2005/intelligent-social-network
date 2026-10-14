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
  it('requires matching registration password confirmation before sending a request', async () => {
    const user = userEvent.setup();
    renderAt('/dang-ky');
    await screen.findByRole('heading', { name: 'Tạo tài khoản mới' });

    await user.type(screen.getByLabelText('Địa chỉ email'), 'an@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'a sufficiently long password');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'a different password');
    await user.click(screen.getByRole('button', { name: /Tạo tài khoản/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu xác nhận chưa khớp.');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/auth/csrf');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/auth/register');
  });

  it('refocuses the error summary when the same confirmation mismatch is submitted again', async () => {
    const user = userEvent.setup();
    renderAt('/dang-ky');
    await screen.findByRole('heading', { name: 'Tạo tài khoản mới' });

    await user.type(screen.getByLabelText('Mật khẩu'), 'a sufficiently long password');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'a different password');
    await user.click(screen.getByRole('button', { name: /Tạo tài khoản/ }));
    const firstSummary = await screen.findByRole('alert');
    expect(firstSummary).toHaveFocus();

    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'x');
    await user.click(screen.getByRole('button', { name: /Tạo tài khoản/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/auth/register');
  });

  it('does not send the registration confirmation to the API', async () => {
    const user = userEvent.setup();
    renderAt('/dang-ky');
    await screen.findByRole('heading', { name: 'Tạo tài khoản mới' });
    fetchMock
      .mockResolvedValueOnce(response(200, { csrfToken: 'anonymous-csrf' }))
      .mockResolvedValueOnce(response(201, { user: { id: 'user-1', email: 'an@example.test' } }));

    await user.type(screen.getByLabelText('Địa chỉ email'), 'an@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'Mật khẩu của tôi đủ dài 🙂');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'Mật khẩu của tôi đủ dài 🙂');
    await user.click(screen.getByRole('button', { name: /Tạo tài khoản/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Tạo tài khoản thành công');
    const registrationRequest = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/register');
    expect(JSON.parse(String(registrationRequest?.[1]?.body))).toEqual({
      email: 'an@example.test',
      password: 'Mật khẩu của tôi đủ dài 🙂',
    });
    expect(screen.getByLabelText('Địa chỉ email')).toHaveValue('an@example.test');
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('');
    expect(screen.getByLabelText('Xác nhận mật khẩu')).toHaveValue('');
  });

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

    expect(await screen.findByRole('heading', { name: /Chào mừng bạn trở lại/ })).toBeVisible();
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
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'a sufficiently long password');
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

  it('shows a retry action when session restoration is unavailable', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(503, { error: { message: 'unavailable' } }));
    renderAt('/dang-nhap');

    expect(await screen.findByText('Dịch vụ đăng nhập hiện chưa khả dụng.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Thử kết nối lại/ }));
    expect(await screen.findByRole('button', { name: /Đăng nhập/ })).toBeEnabled();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/auth/session');
  });

  it('keeps the session visible and offers logout retry when logout fails', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response(200, {
        user: { id: 'user-1', email: 'an@example.test' },
        session: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
      }))
      .mockResolvedValueOnce(response(200, { csrfToken: 'session-csrf' }))
      .mockResolvedValueOnce(response(503, { error: { message: 'unavailable' } }));
    renderAt('/');

    expect(await screen.findByText('an@example.test')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Đăng xuất/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể đăng xuất lúc này.');
    expect(screen.getByText('an@example.test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Thử đăng xuất lại' })).toBeVisible();
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
