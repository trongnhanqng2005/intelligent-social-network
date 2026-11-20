import type { AnomalyAccountReport, AnomalySeverity, UserActivityWindow } from './admin.types.js';

export const SUSPICIOUS_THRESHOLD = 0.45;
export const HIGH_RISK_THRESHOLD = 0.7;

interface BurstRule {
  field1h: keyof Pick<UserActivityWindow, 'failedLogin1h' | 'friendReq1h' | 'post1h' | 'comment1h'>;
  field24h: keyof Pick<UserActivityWindow, 'failedLogin24h' | 'friendReq24h' | 'post24h' | 'comment24h'>;
  threshold1h: number;
  base1h: number;
  step1h: number;
  cap1h: number;
  threshold24h: number;
  base24h: number;
  step24h: number;
  cap24h: number;
  formatReason: (count: number, windowLabel: '1 giờ' | '24 giờ') => string;
}

const BURST_RULES: readonly BurstRule[] = [
  {
    field1h: 'failedLogin1h',
    field24h: 'failedLogin24h',
    threshold1h: 3,
    base1h: 0.45,
    step1h: 0.1,
    cap1h: 0.85,
    threshold24h: 5,
    base24h: 0.28,
    step24h: 0.04,
    cap24h: 0.55,
    formatReason: (count, windowLabel) => `Đăng nhập thất bại ${count} lần trong ${windowLabel} qua`,
  },
  {
    field1h: 'friendReq1h',
    field24h: 'friendReq24h',
    threshold1h: 4,
    base1h: 0.45,
    step1h: 0.08,
    cap1h: 0.8,
    threshold24h: 8,
    base24h: 0.25,
    step24h: 0.03,
    cap24h: 0.5,
    formatReason: (count, windowLabel) => `Gửi ${count} lời mời kết bạn trong ${windowLabel} qua`,
  },
  {
    field1h: 'post1h',
    field24h: 'post24h',
    threshold1h: 4,
    base1h: 0.45,
    step1h: 0.08,
    cap1h: 0.78,
    threshold24h: 10,
    base24h: 0.25,
    step24h: 0.02,
    cap24h: 0.48,
    formatReason: (count, windowLabel) => `Đăng ${count} bài viết trong ${windowLabel} qua`,
  },
  {
    field1h: 'comment1h',
    field24h: 'comment24h',
    threshold1h: 5,
    base1h: 0.45,
    step1h: 0.07,
    cap1h: 0.78,
    threshold24h: 12,
    base24h: 0.25,
    step24h: 0.02,
    cap24h: 0.48,
    formatReason: (count, windowLabel) => `Bình luận ${count} lần trong ${windowLabel} qua`,
  },
];

/**
 * Scores a user's 1h/24h Neo4j activity window using the same causal surge ratio
 * as the anomaly detection experiment and produces human-readable Vietnamese reasons.
 */
export function scoreUserActivity(window: UserActivityWindow): AnomalyAccountReport {
  const recentTotal = window.auth1h + window.friendReq1h + window.post1h + window.comment1h;
  const total24h = window.auth24h + window.friendReq24h + window.post24h + window.comment24h;
  const prior23hTotal = Math.max(0, total24h - recentTotal);
  const recentVsPrior23h = Number((recentTotal / Math.max(prior23hTotal / 23, 1)).toFixed(2));

  let signalScore = 0;
  const reasons: string[] = [];

  for (const rule of BURST_RULES) {
    const count1h = window[rule.field1h];
    const count24h = window[rule.field24h];
    if (count1h >= rule.threshold1h) {
      signalScore += Math.min(rule.cap1h, rule.base1h + (count1h - rule.threshold1h) * rule.step1h);
      reasons.push(rule.formatReason(count1h, '1 giờ'));
    } else if (count24h >= rule.threshold24h) {
      signalScore += Math.min(rule.cap24h, rule.base24h + (count24h - rule.threshold24h) * rule.step24h);
      reasons.push(rule.formatReason(count24h, '24 giờ'));
    }
  }

  if (window.distinctTargets1h >= 5) {
    signalScore += Math.min(0.25, 0.15 + (window.distinctTargets1h - 5) * 0.03);
    reasons.push(`Tương tác hoặc gửi kết nối tới ${window.distinctTargets1h} thành viên khác nhau trong 1 giờ qua`);
  }

  if (recentVsPrior23h >= 4 && recentTotal >= 5) {
    signalScore += Math.min(0.3, 0.18 + (recentVsPrior23h - 4) * 0.03);
    reasons.push(
      `Tần suất hoạt động 1 giờ qua tăng gấp ${recentVsPrior23h.toFixed(1)}x so với trung bình 23 giờ trước`,
    );
  }

  const baselineContribution = reasons.length === 0
    ? Math.min(
        0.2,
        window.failedLogin1h * 0.08 +
          window.failedLogin24h * 0.02 +
          window.friendReq1h * 0.03 +
          window.post1h * 0.02 +
          window.comment1h * 0.015,
      )
    : 0;

  const anomalyScore = Number(Math.min(1, signalScore + baselineContribution).toFixed(4));
  const severity: AnomalySeverity =
    anomalyScore >= HIGH_RISK_THRESHOLD
      ? 'high'
      : anomalyScore >= SUSPICIOUS_THRESHOLD
        ? 'suspicious'
        : 'normal';

  return {
    ...window,
    recentVsPrior23h,
    anomalyScore,
    severity,
    reasons,
  };
}
