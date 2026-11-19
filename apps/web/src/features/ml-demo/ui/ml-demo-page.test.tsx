import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MlDemoPage } from './ml-demo-page';

const fetchMock = vi.fn<typeof fetch>();
const recommendation = { sourceNodeId: 'synthetic-friend-rec-v1:0', candidateNodeId: 'synthetic-friend-rec-v1:2', rank: 1, score: 0.42 };
function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}
const recs = (canViewAlerts: boolean, items = [recommendation]) => response(200, { source: 'synthetic', canViewAlerts, modelVersion: 'friend-v1', computedAt: '2026-11-19T08:00:00Z', items });
const alerts = (items = [{ actorId: 'synthetic-test-actor-001', evaluatedAt: '2026-01-06T00:00:00Z', anomalyScore: .2 }]) =>
  response(200, { source: 'synthetic', modelVersion: 'anomaly-v1', threshold: .14, evaluatedCount: 64, alerts: items });

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function renderPage() { return render(<MlDemoPage />); }

describe('ML demo member page', () => {
  it('shows synthetic recommendations to an authenticated member and never requests alerts without capability', async () => {
    fetchMock.mockResolvedValueOnce(recs(false));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Synthetic Friend Recommendations' })).toBeVisible();
    expect(screen.getByRole('row', { name: /synthetic-friend-rec-v1:2/ })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Synthetic Anomaly Alerts' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/ml-demo/anomalies');
  });

  it('loads reviewer alerts, retries a failed restricted request, and renders empty state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(recs(true)).mockResolvedValueOnce(response(503, {})).mockResolvedValueOnce(recs(true))
      .mockResolvedValueOnce(alerts([]));
    renderPage();
    expect(await screen.findByText('Không thể tải phần cảnh báo bị giới hạn.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Thử lại/ }));
    expect(await screen.findByText('Không có cảnh báo trong tập đánh giá.')).toBeVisible();
    expect(screen.getByText('64')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/ml-demo/anomalies')).toBe(true);
  });

  it('announces authorized alert loading and then the loaded alert count', async () => {
    let resolveAlerts!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(recs(true)).mockImplementationOnce(() => new Promise((resolve) => { resolveAlerts = resolve; }));
    renderPage();
    expect(await screen.findByText('Đang tải cảnh báo…')).toBeVisible();

    resolveAlerts(alerts());
    const announcement = await screen.findByText('Đã tải 1 cảnh báo.');
    expect(announcement).toHaveClass('visually-hidden');
    expect(screen.getByText('64')).toBeVisible();
    expect(screen.getByText('Cảnh báo').previousElementSibling).toHaveTextContent('1');
  });

  it('renders a successful empty recommendation result', async () => {
    fetchMock.mockResolvedValueOnce(recs(false, []));
    renderPage();
    await waitFor(() => expect(screen.getByText('Chưa có kết quả tổng hợp.')).toBeVisible());
  });
});
