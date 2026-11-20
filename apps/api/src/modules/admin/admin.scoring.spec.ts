import { scoreUserActivity } from './admin.scoring.js';
import type { UserActivityWindow } from './admin.types.js';

function baseWindow(overrides: Partial<UserActivityWindow> = {}): UserActivityWindow {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'an@example.test',
    displayName: 'Nguyễn An',
    auth1h: 1,
    auth24h: 2,
    failedLogin1h: 0,
    failedLogin24h: 0,
    friendReq1h: 0,
    friendReq24h: 1,
    post1h: 0,
    post24h: 1,
    comment1h: 0,
    comment24h: 2,
    distinctTargets1h: 0,
    distinctTargets24h: 2,
    lastActivityAt: '2026-11-20T01:00:00.000Z',
    ...overrides,
  };
}

describe('scoreUserActivity', () => {
  it('classifies ordinary low-frequency activity as normal with no warning reasons', () => {
    const result = scoreUserActivity(baseWindow());
    expect(result.severity).toBe('normal');
    expect(result.anomalyScore).toBeLessThan(0.45);
    expect(result.reasons).toEqual([]);
  });

  it('flags 3+ recent failed logins as suspicious and 5+ with activity surge as high risk', () => {
    const suspicious = scoreUserActivity(baseWindow({ auth1h: 3, auth24h: 3, failedLogin1h: 3, failedLogin24h: 3 }));
    expect(suspicious.severity).toBe('suspicious');
    expect(suspicious.reasons).toContain('Đăng nhập thất bại 3 lần trong 1 giờ qua');

    const high = scoreUserActivity(baseWindow({ auth1h: 6, auth24h: 6, failedLogin1h: 6, failedLogin24h: 6 }));
    expect(high.severity).toBe('high');
    expect(high.anomalyScore).toBeGreaterThanOrEqual(0.7);
    expect(high.reasons.some((reason) => reason.includes('Đăng nhập thất bại 6 lần'))).toBe(true);
    expect(high.reasons.some((reason) => reason.includes('Tần suất hoạt động 1 giờ qua tăng gấp'))).toBe(true);
  });

  it('flags friend request, post, and comment bursts with Vietnamese explanations', () => {
    const result = scoreUserActivity(baseWindow({
      friendReq1h: 5,
      friendReq24h: 5,
      post1h: 4,
      post24h: 4,
      comment1h: 6,
      comment24h: 6,
      distinctTargets1h: 6,
    }));
    expect(result.severity).toBe('high');
    expect(result.anomalyScore).toBe(1);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'Gửi 5 lời mời kết bạn trong 1 giờ qua',
      'Đăng 4 bài viết trong 1 giờ qua',
      'Bình luận 6 lần trong 1 giờ qua',
      'Tương tác hoặc gửi kết nối tới 6 thành viên khác nhau trong 1 giờ qua',
    ]));
  });
});
