import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAllowedUserId } from '../../config/uuid-allowlist.js';
import type { AuthPrincipal } from '../auth/auth-session.guard.js';
import { AdminRepository } from './admin.repository.js';
import { HIGH_RISK_THRESHOLD, scoreUserActivity, SUSPICIOUS_THRESHOLD } from './admin.scoring.js';
import type { AdminAnomaliesResponse } from './admin.types.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: AdminRepository,
  ) {}

  isAdmin(user: AuthPrincipal): boolean {
    return isAllowedUserId(this.config, 'ADMIN_USER_IDS', user.id);
  }

  async listAnomalies(user: AuthPrincipal): Promise<AdminAnomaliesResponse> {
    if (!this.isAdmin(user)) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_FORBIDDEN',
          message: 'Bạn không có quyền truy cập trang quản trị này.',
        },
      });
    }

    const evaluatedAt = new Date().toISOString();
    const windows = await this.repository.listUserActivityWindows(evaluatedAt);
    const items = windows
      .map(scoreUserActivity)
      .sort((left, right) =>
        right.anomalyScore - left.anomalyScore ||
        (right.failedLogin1h + right.friendReq1h + right.post1h + right.comment1h) -
          (left.failedLogin1h + left.friendReq1h + left.post1h + left.comment1h) ||
        left.email.localeCompare(right.email),
      );

    return {
      evaluatedAt,
      threshold: {
        suspicious: SUSPICIOUS_THRESHOLD,
        high: HIGH_RISK_THRESHOLD,
      },
      summary: {
        totalUsers: items.length,
        suspiciousCount: items.filter((item) => item.severity !== 'normal').length,
        highRiskCount: items.filter((item) => item.severity === 'high').length,
      },
      items,
    };
  }
}
