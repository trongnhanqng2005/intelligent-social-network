import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service.js';
import type { UserActivityWindow } from './admin.types.js';

const adminUser = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test', jti: 'j1', expiresAt: '' };
const normalUser = { id: '22222222-2222-4222-8222-222222222222', email: 'member@example.test', jti: 'j2', expiresAt: '' };

function windowRow(overrides: Partial<UserActivityWindow>): UserActivityWindow {
  return {
    userId: normalUser.id,
    email: normalUser.email,
    displayName: 'Bình Trần',
    auth1h: 0,
    auth24h: 0,
    failedLogin1h: 0,
    failedLogin24h: 0,
    friendReq1h: 0,
    friendReq24h: 0,
    post1h: 0,
    post24h: 0,
    comment1h: 0,
    comment24h: 0,
    distinctTargets1h: 0,
    distinctTargets24h: 0,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('AdminService', () => {
  it('rejects non-admin callers with 403 without querying repository', async () => {
    const repository = { listUserActivityWindows: jest.fn() };
    const service = new AdminService(new ConfigService({ ADMIN_USER_IDS: adminUser.id }), repository as never);

    expect(service.isAdmin(adminUser)).toBe(true);
    expect(service.isAdmin(normalUser)).toBe(false);

    await expect(service.listAnomalies(normalUser)).rejects.toMatchObject({ status: 403 });
    expect(repository.listUserActivityWindows).not.toHaveBeenCalled();
  });

  it('scores, sorts highest risk first, and summarizes suspicious accounts for admin', async () => {
    const repository = {
      listUserActivityWindows: jest.fn().mockResolvedValue([
        windowRow({ userId: adminUser.id, email: adminUser.email, displayName: 'An Nguyễn' }),
        windowRow({
          userId: normalUser.id, email: normalUser.email, displayName: 'Bình Trần',
          auth1h: 5, auth24h: 5, failedLogin1h: 5, failedLogin24h: 5,
        }),
      ]),
    };
    const service = new AdminService(new ConfigService({ ADMIN_USER_IDS: adminUser.id }), repository as never);

    const report = await service.listAnomalies(adminUser);
    expect(report.summary).toEqual({ totalUsers: 2, suspiciousCount: 1, highRiskCount: 1 });
    expect(report.items[0]?.userId).toBe(normalUser.id);
    expect(report.items[0]?.severity).toBe('high');
    expect(report.items[1]?.userId).toBe(adminUser.id);
    expect(report.items[1]?.severity).toBe('normal');
  });
});
