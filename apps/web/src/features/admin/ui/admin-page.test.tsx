import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { getAdminAnomalies, AdminApiError, type AdminAnomaliesResponse } from '../api/admin-api';
import { AdminPage } from './admin-page';

const retry = vi.fn();
vi.mock('../../auth/model/auth-context', () => ({ useAuth: () => ({ retry }) }));
vi.mock('../api/admin-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-api')>();
  return {
    ...actual,
    getAdminAnomalies: vi.fn(),
  };
});

const reportPayload: AdminAnomaliesResponse = {
  evaluatedAt: '2026-11-20T02:00:00.000Z',
  threshold: { suspicious: 0.45, high: 0.7 },
  summary: { totalUsers: 2, suspiciousCount: 1, highRiskCount: 1 },
  items: [
    {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'spam@example.test',
      displayName: 'Bình Trần',
      auth1h: 6,
      auth24h: 6,
      failedLogin1h: 6,
      failedLogin24h: 6,
      friendReq1h: 0,
      friendReq24h: 0,
      post1h: 0,
      post24h: 0,
      comment1h: 0,
      comment24h: 0,
      distinctTargets1h: 0,
      distinctTargets24h: 0,
      lastActivityAt: '2026-11-20T01:59:00.000Z',
      recentVsPrior23h: 6,
      anomalyScore: 0.99,
      severity: 'high',
      reasons: ['Đăng nhập thất bại 6 lần trong 1 giờ qua'],
    },
    {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'normal@example.test',
      displayName: 'An Nguyễn',
      auth1h: 1,
      auth24h: 1,
      failedLogin1h: 0,
      failedLogin24h: 0,
      friendReq1h: 0,
      friendReq24h: 1,
      post1h: 0,
      post24h: 1,
      comment1h: 0,
      comment24h: 0,
      distinctTargets1h: 0,
      distinctTargets24h: 1,
      lastActivityAt: '2026-11-20T01:30:00.000Z',
      recentVsPrior23h: 1,
      anomalyScore: 0,
      severity: 'normal',
      reasons: [],
    },
  ],
};

beforeEach(() => {
  retry.mockReset();
  vi.mocked(getAdminAnomalies).mockReset().mockResolvedValue(reportPayload);
});

afterEach(cleanup);

describe('AdminPage', () => {
  it('shows flagged suspicious accounts with score and reasons, and supports toggling to all accounts', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/quan-tri']}><AdminPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Giám sát tài khoản bất thường' })).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Bình Trần' })).toBeVisible();
    expect(screen.getByText('Cảnh báo mức cao')).toBeVisible();
    expect(screen.getByText('Điểm: 0.99')).toBeVisible();
    expect(screen.getByText('Đăng nhập thất bại 6 lần trong 1 giờ qua')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'An Nguyễn' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tất cả tài khoản/ }));
    expect(await screen.findByRole('link', { name: 'An Nguyễn' })).toBeVisible();
    expect(screen.getByText('Hoạt động trong ngưỡng bình thường')).toBeVisible();
  });

  it('shows forbidden message when non-admin accesses admin endpoint', async () => {
    vi.mocked(getAdminAnomalies).mockRejectedValueOnce(new AdminApiError('Forbidden', 403, 'ADMIN_FORBIDDEN'));
    render(<MemoryRouter initialEntries={['/quan-tri']}><AdminPage /></MemoryRouter>);

    expect(await screen.findByText(/Bạn không có quyền truy cập trang quản trị/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Quét lại ngay/ })).not.toBeInTheDocument();
  });
});
