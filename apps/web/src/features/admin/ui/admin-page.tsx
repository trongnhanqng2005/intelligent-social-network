import { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useAuth } from '../../auth/model/auth-context';
import { AdminApiError, getAdminAnomalies, type AdminAnomaliesResponse, type AnomalySeverity } from '../api/admin-api';
import './admin.css';

type FilterMode = 'flagged' | 'all';

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  normal: 'Bình thường',
  suspicious: 'Nghi ngờ',
  high: 'Cảnh báo cao',
};

export function AdminPage() {
  const { retry: retrySession } = useAuth();
  const location = useLocation();
  const [data, setData] = useState<AdminAnomaliesResponse>();
  const [filter, setFilter] = useState<FilterMode>('flagged');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setForbidden(false);
    getAdminAnomalies(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof AdminApiError) {
        if (cause.status === 401) retrySession();
        if (cause.status === 403) {
          setForbidden(true);
          setLoading(false);
          return;
        }
        setError(cause.message);
      } else {
        setError('Chưa thể tải báo cáo bất thường.');
      }
      setLoading(false);
    });
    return () => controller.abort();
  }, [reloadKey, retrySession]);

  const visibleItems = (data?.items ?? []).filter((item) => filter === 'all' || item.severity !== 'normal');
  const returnTo = `${location.pathname}${location.search}`;

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <header className="admin-page__header">
        <div>
          <span className="profile-eyebrow">QUẢN TRỊ HỆ THỐNG</span>
          <h1 id="admin-title">Giám sát tài khoản bất thường</h1>
          <p>
            Theo dõi hành vi người dùng theo thời gian thực trên cửa sổ 1 giờ và 24 giờ từ Neo4j
            (đăng nhập thất bại, spam lời mời kết bạn, đăng bài hoặc bình luận đột biến).
          </p>
        </div>
        {!forbidden && (
          <Button type="button" variant="secondary" disabled={loading} onClick={() => setReloadKey((n) => n + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Quét lại ngay
          </Button>
        )}
      </header>

      {loading && <p role="status">Đang tổng hợp hành vi và chấm điểm tài khoản…</p>}

      {forbidden && (
        <Alert tone="error">
          Bạn không có quyền truy cập trang quản trị. Chỉ tài khoản được cấu hình trong ADMIN_USER_IDS mới xem được mục này.
        </Alert>
      )}

      {error && !forbidden && (
        <div className="admin-state">
          <Alert tone="error">{error}</Alert>
          <Button type="button" variant="secondary" onClick={() => setReloadKey((n) => n + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Thử lại
          </Button>
        </div>
      )}

      {!loading && !error && !forbidden && data && (
        <>
          <div className="admin-summary">
            <div className="admin-stat">
              <strong>{data.summary.totalUsers}</strong>
              <span>Tổng tài khoản đã quét</span>
            </div>
            <div className="admin-stat admin-stat--warn">
              <strong>{data.summary.suspiciousCount}</strong>
              <span>Tài khoản nghi ngờ</span>
            </div>
            <div className="admin-stat admin-stat--high">
              <strong>{data.summary.highRiskCount}</strong>
              <span>Cảnh báo mức cao</span>
            </div>
          </div>

          <div className="admin-toolbar">
            <div className="admin-filters" role="group" aria-label="Lọc danh sách tài khoản">
              <Button
                type="button"
                variant={filter === 'flagged' ? 'primary' : 'secondary'}
                onClick={() => setFilter('flagged')}
              >
                <ShieldAlert size={16} aria-hidden="true" /> Tài khoản nghi ngờ ({data.summary.suspiciousCount})
              </Button>
              <Button
                type="button"
                variant={filter === 'all' ? 'primary' : 'secondary'}
                onClick={() => setFilter('all')}
              >
                Tất cả tài khoản ({data.summary.totalUsers})
              </Button>
            </div>
            <p className="admin-meta">
              Ngưỡng nghi ngờ ≥ {data.threshold.suspicious.toFixed(2)} · Mức cao ≥ {data.threshold.high.toFixed(2)} · Cập nhật lúc{' '}
              {formatTimestamp(data.evaluatedAt)}
            </p>
          </div>

          <div className="admin-panel">
            {visibleItems.length === 0 ? (
              <div className="admin-empty">
                <h2>Chưa phát hiện tài khoản nào bất thường.</h2>
                <p>
                  Mọi hoạt động hiện tại đều ở mức bình thường. Bạn có thể chuyển sang chế độ &ldquo;Tất cả tài khoản&rdquo;
                  để theo dõi chỉ số từng thành viên khi kiểm thử.
                </p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Tài khoản</th>
                      <th>Mức độ &amp; Điểm</th>
                      <th>Chỉ số (1h / 24h)</th>
                      <th>Lý do nghi ngờ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <tr key={item.userId}>
                        <td>
                          <Link
                            className="admin-account-name"
                            to={`/thanh-vien/${encodeURIComponent(item.userId)}`}
                            state={{ from: returnTo }}
                          >
                            {item.displayName}
                          </Link>
                          <span className="admin-account-email">{item.email}</span>
                        </td>
                        <td>
                          <span className={`admin-badge admin-badge--${item.severity}`}>
                            {SEVERITY_LABEL[item.severity]}
                          </span>
                          <span className="admin-score">Điểm: {item.anomalyScore.toFixed(2)}</span>
                        </td>
                        <td>
                          <div className="admin-metrics">
                            <span>Đăng nhập sai: <strong>{item.failedLogin1h}</strong> / {item.failedLogin24h}</span>
                            <span>Lời mời kết bạn: <strong>{item.friendReq1h}</strong> / {item.friendReq24h}</span>
                            <span>Bài viết: <strong>{item.post1h}</strong> / {item.post24h}</span>
                            <span>Bình luận: <strong>{item.comment1h}</strong> / {item.comment24h}</span>
                            <span>Đột biến 1h/23h: <strong>{item.recentVsPrior23h.toFixed(1)}x</strong></span>
                          </div>
                        </td>
                        <td>
                          {item.reasons.length > 0 ? (
                            <ul className="admin-reasons">
                              {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          ) : (
                            <span className="admin-reasons-empty">Hoạt động trong ngưỡng bình thường</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function formatTimestamp(value: string): string {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(millis);
}
