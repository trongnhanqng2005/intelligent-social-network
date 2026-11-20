import { useEffect, useState } from 'react';
import { Button } from '../../../shared/ui/button';
import { getAnomalies, reviewAnomaly, type AnomaliesResponse, MlDemoApiError } from '../../ml-demo/api/ml-demo-api';
import './admin.css';

export function AdminAlertsPage({ onForbidden }: { onForbidden?(): void }) {
  const [data, setData] = useState<AnomaliesResponse>();
  const [filter, setFilter] = useState('unreviewed');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(false); setData(undefined);
    getAnomalies(controller.signal).then((d) => { if (!controller.signal.aborted) setData(d); })
      .catch((e: unknown) => { if (!controller.signal.aborted) { if (e instanceof MlDemoApiError && e.status === 403) onForbidden?.(); setError(true); } });
    return () => controller.abort();
  }, [attempt, onForbidden]);
  const alerts = data?.alerts.filter((a) => filter === 'all' || (filter === 'reviewed' ? Boolean(a.reviewedAt) : !a.reviewedAt)) ?? [];
  async function mark(actorId: string) {
    if (!data) return;
    setBusy(actorId);
    try {
      const reviewedAt = await reviewAnomaly(data.snapshotId, actorId);
      setData((current) => current && ({ ...current, alerts: current.alerts.map((a) => a.actorId === actorId ? { ...a, reviewedAt } : a) }));
    } catch { setError(true); }
    finally { setBusy(''); }
  }
  return <section className="admin-dashboard"><span className="profile-eyebrow">WEYLUME · QUẢN TRỊ</span><h1>Cảnh báo bất thường</h1>
    <p>Dữ liệu tổng hợp dùng cho đánh giá mô hình; không phải tài khoản hay hoạt động thật.</p>
    <label>Trạng thái <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="unreviewed">Chưa xem</option><option value="reviewed">Đã xem</option><option value="all">Tất cả</option></select></label>
    {error && <p role="alert">Không thể tải hoặc cập nhật cảnh báo. <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button></p>}
    {!data && !error && <p role="status">Đang tải cảnh báo…</p>}
    {data && <><p>{alerts.length} cảnh báo · {data.evaluatedCount} tác nhân đã đánh giá</p>
      {alerts.length === 0 ? <p className="admin-empty">Không có cảnh báo trong trạng thái đã chọn.</p> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Mã tổng hợp</th><th>Điểm</th><th>Đánh giá</th><th>Trạng thái</th></tr></thead><tbody>{alerts.map((a) => <tr key={a.actorId}><td>{a.actorId}</td><td>{a.anomalyScore.toFixed(4)}</td><td>{new Date(a.evaluatedAt).toLocaleString('vi-VN')}</td><td>{a.reviewedAt ? 'Đã xem' : <Button variant="secondary" pending={busy === a.actorId} disabled={Boolean(busy)} onClick={() => void mark(a.actorId)}>Đánh dấu đã xem</Button>}</td></tr>)}</tbody></table></div>}
    </>}</section>;
}
