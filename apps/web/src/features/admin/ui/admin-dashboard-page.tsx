import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { resolveApiUrl } from '../../../shared/config/env';
import './admin.css';

type Stats = { users: number; friendships: number; posts: number; comments: number };
export function AdminDashboardPage({ onForbidden }: { onForbidden?(): void } = {}) {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(resolveApiUrl('/admin/stats'), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 403) onForbidden?.();
        if (!response.ok) throw new Error();
        return response.json() as Promise<Stats>;
      })
      .then(setStats).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [onForbidden]);
  return <section className="admin-dashboard" aria-labelledby="admin-title">
    <span className="profile-eyebrow">WEYLUME · QUẢN TRỊ</span><h1 id="admin-title">Tổng quan hệ thống</h1>
    <p>Số liệu ứng dụng, tách biệt với các bản minh họa dữ liệu tổng hợp.</p>
    {error && <p role="alert">Không thể tải số liệu quản trị.</p>}
    {!stats && !error && <p role="status">Đang tải số liệu…</p>}
    {stats && <dl className="admin-stats">{Object.entries({ 'Thành viên': stats.users, 'Kết nối bạn bè': stats.friendships, 'Bài viết': stats.posts, 'Bình luận': stats.comments }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <section className="admin-synthetic" aria-labelledby="synthetic-title"><h2 id="synthetic-title">Khu vực dữ liệu tổng hợp</h2><p>Phân tích minh họa không đại diện cho dữ liệu ứng dụng.</p><Link to="/quan-tri/nghien-cuu">Mở nghiên cứu tổng hợp</Link></section>
  </section>;
}
