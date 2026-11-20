import { useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, useLocation } from 'react-router';
import { Activity, LayoutDashboard, LogOut, MessageSquare, Newspaper, UsersRound, FlaskConical } from 'lucide-react';
import { useAuth } from '../../auth/model/auth-context';
import { Button } from '../../../shared/ui/button';
import { BrandLockup } from '../../../shared/brand/brand-lockup';
import './admin-layout.css';

const links = [
  ['/quan-tri', 'Quản trị', LayoutDashboard],
  ['/quan-tri/thanh-vien', 'Thành viên', UsersRound],
  ['/quan-tri/bai-viet', 'Bài viết', Newspaper],
  ['/quan-tri/binh-luan', 'Bình luận', MessageSquare],
  ['/quan-tri/canh-bao', 'Cảnh báo', Activity],
  ['/quan-tri/nghien-cuu', 'Nghiên cứu', FlaskConical],
] as const;
export function AdminLayout({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState('');
  const [pending, setPending] = useState(false);
  if (state.status === 'loading') return <main className="admin-session-state" role="status">Đang xác minh quyền quản trị…</main>;
  if (state.status === 'unavailable') return <main className="admin-session-state" role="alert"><h1>Chưa thể xác minh quyền</h1><p>{state.message}</p><Button variant="secondary" onClick={() => window.location.reload()}>Thử lại</Button></main>;
  if (state.status === 'anonymous') return <Navigate to={`/dang-nhap?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  if (state.session.user.role !== 'ADMIN') return <Navigate to="/ban-be" replace />;
  async function signOut() {
    setPending(true); setLogoutError('');
    try { await logout(); } catch { setLogoutError('Không thể đăng xuất lúc này.'); }
    finally { setPending(false); }
  }
  return <div className="admin-shell">
    <a className="skip-link" href="#admin-content">Đi đến nội dung chính</a>
    <aside className="admin-sidebar">
      <BrandLockup />
      <p className="admin-sidebar__label">QUẢN TRỊ</p>
      <nav aria-label="Điều hướng quản trị">{links.map(([to, label, Icon]) =>
        <NavLink key={to} to={to} end={to === '/quan-tri'} className={({ isActive }) => `admin-nav-link${isActive ? ' is-active' : ''}`}>
          <Icon size={18} aria-hidden="true" />{label}
        </NavLink>)}</nav>
      <Link className="admin-back-social" to="/bang-tin">← Quay lại mạng xã hội</Link>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div className="admin-mobile-brand"><BrandLockup /></div>
        <span className="admin-account">{state.status === 'authenticated' ? state.session.user.email : 'Quản trị viên'}</span>
        <Button variant="ghost" pending={pending} pendingLabel="Đang đăng xuất…" onClick={() => void signOut()}><LogOut size={17} aria-hidden="true" /> Đăng xuất</Button>
      </header>
      {logoutError && <p role="alert" className="admin-toast">{logoutError}</p>}
      <main id="admin-content" className="admin-content" key={location.pathname}>{children}</main>
    </div>
  </div>;
}
