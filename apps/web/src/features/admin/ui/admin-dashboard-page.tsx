import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { resolveApiUrl } from '../../../shared/config/env';
import { getAnomalies } from '../../ml-demo/api/ml-demo-api';
import './admin.css';

type Stats = { users: number; friendships: number; posts: number; comments: number };
export function AdminDashboardPage({ onForbidden }: { onForbidden?(): void } = {}) {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState(false);
  const [anomalyCount, setAnomalyCount] = useState<number>();
  const [snapshotUnavailable, setSnapshotUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(resolveApiUrl('/admin/stats'), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 403) onForbidden?.();
        if (!response.ok) throw new Error();
        return response.json() as Promise<Stats>;
      })
      .then(setStats).catch(() => { if (!controller.signal.aborted) setError(true); });
    getAnomalies(controller.signal).then((result) => { if (!controller.signal.aborted) setAnomalyCount(result.alerts.length); }).catch(() => { if (!controller.signal.aborted) setSnapshotUnavailable(true); });
    return () => controller.abort();
  }, [onForbidden]);
  return <section className="admin-dashboard" aria-labelledby="admin-title">
    <span className="profile-eyebrow">WEYLUME · QUẢN TRỊ</span><h1 id="admin-title">Tổng quan hệ thống</h1>
    <p>Số liệu ứng dụng, tách biệt với các bản minh họa dữ liệu tổng hợp.</p>
    {error && <p role="alert">Không thể tải số liệu quản trị.</p>}
    {!stats && !error && <p role="status">Đang tải số liệu…</p>}
    {stats && <><h2>Số liệu ứng dụng</h2><dl className="admin-stats">{Object.entries({ 'Thành viên': stats.users, 'Kết nối bạn bè': stats.friendships, 'Bài viết': stats.posts, 'Bình luận': stats.comments }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}
    <section className="admin-synthetic" aria-labelledby="synthetic-title"><h2 id="synthetic-title">Số liệu nghiên cứu tổng hợp</h2><p>Các chỉ số bên dưới được tách biệt, không đại diện cho dữ liệu ứng dụng.</p><p>{snapshotUnavailable ? 'Snapshot cảnh báo chưa sẵn sàng.' : anomalyCount === undefined ? 'Đang tải số cảnh báo…' : `${anomalyCount} cảnh báo trong snapshot hiện tại`}</p><Link to="/quan-tri/nghien-cuu">Mở nghiên cứu tổng hợp</Link></section>
  </section>;
}
