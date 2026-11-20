export type AnomalySeverity = 'normal' | 'suspicious' | 'high';

export interface UserActivityWindow {
  userId: string;
  email: string;
  displayName: string;
  auth1h: number;
  auth24h: number;
  failedLogin1h: number;
  failedLogin24h: number;
  friendReq1h: number;
  friendReq24h: number;
  post1h: number;
  post24h: number;
  comment1h: number;
  comment24h: number;
  distinctTargets1h: number;
  distinctTargets24h: number;
  lastActivityAt: string | null;
}

export interface AnomalyAccountReport extends UserActivityWindow {
  recentVsPrior23h: number;
  anomalyScore: number;
  severity: AnomalySeverity;
  reasons: string[];
}

export interface AdminAnomaliesResponse {
  evaluatedAt: string;
  threshold: {
    suspicious: number;
    high: number;
  };
  summary: {
    totalUsers: number;
    suspiciousCount: number;
    highRiskCount: number;
  };
  items: AnomalyAccountReport[];
}
