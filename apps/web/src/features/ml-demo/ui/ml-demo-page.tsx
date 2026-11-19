import { useEffect, useState } from 'react';
import { Activity, BrainCircuit, RefreshCw } from 'lucide-react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { getAnomalies, getRecommendations, MlDemoApiError, type AnomaliesResponse, type RecommendationsResponse } from '../api/ml-demo-api';
import './ml-demo.css';

export function MlDemoPage() {
  const [attempt, setAttempt] = useState(0);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse>();
  const [anomalies, setAnomalies] = useState<AnomaliesResponse>();
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [anomalyError, setAnomalyError] = useState(false);
  const [limitedAccess, setLimitedAccess] = useState(false);
  const [alertPage, setAlertPage] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false); setAnomalyError(false); setLimitedAccess(false); setAnomalies(undefined);
    getRecommendations(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRecommendations(result);
      const sources = [...new Set(result.items.map((item) => item.sourceNodeId))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      setSelected((current) => sources.includes(current) ? current : sources[0] ?? '');
      if (!controller.signal.aborted) setLoading(false);
    }).catch(() => {
      if (!controller.signal.aborted) { setError(true); setLoading(false); }
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!recommendations?.canViewAlerts) return;
    const controller = new AbortController();
    setAnomalyError(false); setLimitedAccess(false); setAnomalies(undefined);
    getAnomalies(controller.signal).then((data) => {
      if (!controller.signal.aborted) setAnomalies(data);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof MlDemoApiError && error.status === 403) setLimitedAccess(true);
      else setAnomalyError(true);
    });
    return () => controller.abort();
  }, [attempt, recommendations?.canViewAlerts]);

  const sources = [...new Set(recommendations?.items.map((item) => item.sourceNodeId) ?? [])];
  sources.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const rows = (recommendations?.items.filter((item) => item.sourceNodeId === selected) ?? []).sort((a, b) => a.rank - b.rank);
  const sortedAlerts = [...(anomalies?.alerts ?? [])].sort((a, b) => a.actorId.localeCompare(b.actorId, 'en', { numeric: true }));
  const visibleAlerts = sortedAlerts.slice(alertPage * 10, alertPage * 10 + 10);
  return (
    <section className="ml-demo" aria-labelledby="ml-demo-title">
      <header className="ml-demo__intro">
        <h1 id="ml-demo-title">Mô hình học máy</h1>
        <p>Kết quả trên dữ liệu tổng hợp phục vụ minh họa; không liên kết với tài khoản thật và không tạo lời mời kết bạn.</p>
      </header>
      {loading && <p role="status">Đang tải kết quả nghiên cứu…</p>}
      {error && <div className="ml-demo__state"><Alert tone="error">Không thể tải dữ liệu nghiên cứu tổng hợp.</Alert><Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={16} /> Thử lại</Button></div>}
      {!loading && !error && recommendations && <>
        <article className="ml-demo__panel" aria-labelledby="recommendation-title">
          <div className="ml-demo__panel-heading"><BrainCircuit aria-hidden="true" /><div><h2 id="recommendation-title">Synthetic Friend Recommendations</h2><p>Gợi ý nút ứng viên tổng hợp theo thứ hạng; không đại diện cho thành viên.</p></div></div>
          <div className="ml-demo__meta"><span>Phiên bản: {recommendations.modelVersion ?? '—'}</span><span>Thời điểm: {recommendations.computedAt ? new Date(recommendations.computedAt).toLocaleString('vi-VN', { timeZone: 'UTC' }) + ' UTC' : '—'}</span></div>
          {sources.length === 0 ? <p className="ml-demo__empty">Chưa có kết quả tổng hợp.</p> : <>
            <label className="ml-demo__select">Nút phân tích
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select>
            </label>
            <div className="ml-demo__table-wrap"><table><thead><tr><th>Hạng</th><th>Nút ứng viên</th><th>Điểm</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.candidateNodeId}><td>{row.rank}</td><td>{row.candidateNodeId}</td><td>{row.score.toFixed(4)}</td></tr>)}</tbody>
            </table></div>
          </>}
        </article>
        {recommendations.canViewAlerts && <article className="ml-demo__panel" aria-labelledby="anomaly-title">
          <div className="ml-demo__panel-heading"><Activity aria-hidden="true" /><div><h2 id="anomaly-title">Synthetic Anomaly Alerts</h2><p>Các cảnh báo đánh giá tổng hợp; chỉ người được chủ sở hữu cho phép mới xem.</p></div></div>
          {limitedAccess && <p role="status">Phần cảnh báo chỉ dành cho người được cấp quyền xem.</p>}
          {anomalyError && <div className="ml-demo__state"><Alert tone="error">Không thể tải phần cảnh báo bị giới hạn.</Alert><Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={16} /> Thử lại</Button></div>}
          {anomalies && <>
            <div className="ml-demo__counts"><div><strong>{anomalies.evaluatedCount}</strong><span>Tác nhân đã đánh giá</span></div><div><strong>{anomalies.alerts.length}</strong><span>Cảnh báo</span></div></div>
            <p className="ml-demo__meta">Phiên bản: {anomalies.modelVersion} · Ngưỡng: {anomalies.threshold.toFixed(4)}</p>
            {anomalies.alerts.length === 0 ? <p className="ml-demo__empty">Không có cảnh báo trong tập đánh giá.</p> :
              <div className="ml-demo__table-wrap"><table><thead><tr><th>Mã tổng hợp</th><th>Điểm bất thường</th><th>Thời điểm (UTC)</th></tr></thead>
                <tbody>{visibleAlerts.map((alert) => <tr key={alert.actorId}><td>{alert.actorId}</td><td>{alert.anomalyScore.toFixed(4)}</td><td>{new Date(alert.evaluatedAt).toLocaleString('vi-VN', { timeZone: 'UTC' })}</td></tr>)}</tbody>
              </table></div>}
            {sortedAlerts.length > 10 && <nav className="ml-demo__pagination" aria-label="Trang cảnh báo">
              <Button variant="secondary" disabled={alertPage === 0} onClick={() => setAlertPage((page) => page - 1)}>Trước</Button>
              <span aria-live="polite">Trang {alertPage + 1}/{Math.ceil(sortedAlerts.length / 10)}</span>
              <Button variant="secondary" disabled={(alertPage + 1) * 10 >= sortedAlerts.length} onClick={() => setAlertPage((page) => page + 1)}>Tiếp</Button>
            </nav>}
          </>}
        </article>}
      </>}
    </section>
  );
}
