import { ConfigService } from '@nestjs/config';
import { MlDemoService } from './ml-demo.service.js';

const reviewer = { id: '11111111-1111-4111-8111-111111111111', email: '', jti: '', expiresAt: '' };
const stranger = { ...reviewer, id: '22222222-2222-4222-8222-222222222222' };

describe('MlDemoService', () => {
  it('uses exact canonical UUID allowlist membership and fails closed for invalid configuration', () => {
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: `${reviewer.id},${stranger.id}` })).canViewAlerts(reviewer)).toBe(true);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: '' })).canViewAlerts(reviewer)).toBe(false);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: `${reviewer.id}-extra` })).canViewAlerts(reviewer)).toBe(false);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: `${reviewer.id}, ${stranger.id}` })).canViewAlerts(reviewer)).toBe(false);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: 'x'.repeat(4097) })).canViewAlerts(reviewer)).toBe(false);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: 42 })).canViewAlerts(reviewer)).toBe(false);
    expect(new MlDemoService(new ConfigService({ ML_DEMO_ALERT_REVIEWER_IDS: reviewer.id })).canViewAlerts({ ...reviewer, id: 'not-a-uuid' })).toBe(false);
  });

  it('fails closed with a generic error when bundle is disabled or invalid', async () => {
    const service = new MlDemoService(new ConfigService({}));
    await expect(service.recommendations(reviewer)).rejects.toMatchObject({ status: 503 });
    await expect(service.anomalies(stranger)).rejects.toMatchObject({ status: 403 });
  });
});
