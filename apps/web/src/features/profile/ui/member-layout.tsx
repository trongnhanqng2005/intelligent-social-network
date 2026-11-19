import { useState, type ReactNode } from 'react';
import { Compass, LogOut, Newspaper, UserRound, UsersRound } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { BrandLockup } from '../../../shared/brand/brand-lockup';
import { Button } from '../../../shared/ui/button';
import './profile.css';

export function MemberLayout({ children }: { children: ReactNode }) {
  const { state, retry, logout } = useAuth();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState('');
  const [pending, setPending] = useState(false);

  if (state.status === 'loading') {
    return <main className="member-session-state" role="status">Đang kiểm tra phiên đăng nhập…</main>;
  }
  if (state.status === 'unavailable') {
    return (
      <main className="member-session-state" aria-labelledby="session-unavailable-title">
        <h1 id="session-unavailable-title">Chưa thể xác minh phiên</h1>
        <p>{state.message} Hồ sơ chỉ dành cho thành viên đã đăng nhập.</p>
        <Button variant="secondary" onClick={retry}>Thử kết nối lại</Button>
      </main>
    );
  }
  if (state.status === 'anonymous') {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/dang-nhap?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  async function handleLogout() {
    setPending(true);
    setLogoutError('');
    try {
      await logout();
    } catch {
      setLogoutError('Không thể đăng xuất lúc này. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="member-shell">
      <a className="skip-link" href="#member-content">Đi đến nội dung chính</a>
      <header className="member-header">
        <BrandLockup />
        <nav className="member-nav" aria-label="Điều hướng thành viên">
          <Link to="/ho-so" aria-current={location.pathname === '/ho-so' ? 'page' : undefined}>
            <UserRound size={17} aria-hidden="true" /> Hồ sơ của tôi
          </Link>
          <Link to="/bang-tin" aria-current={location.pathname.startsWith('/bang-tin') ? 'page' : undefined}>
            <Newspaper size={17} aria-hidden="true" /> Bảng tin
          </Link>
          <Link to="/kham-pha" aria-current={location.pathname.startsWith('/kham-pha') ? 'page' : undefined}>
            <Compass size={17} aria-hidden="true" /> Khám phá
          </Link>
          <Link to="/ban-be" aria-current={location.pathname === '/ban-be' || location.pathname.startsWith('/ban-be/') ? 'page' : undefined}>
            <UsersRound size={17} aria-hidden="true" /> Bạn bè
          </Link>
        </nav>
        <Button variant="ghost" pending={pending} pendingLabel="Đang đăng xuất…" onClick={handleLogout}>
          <LogOut size={17} aria-hidden="true" /> Đăng xuất
        </Button>
      </header>
      {logoutError && <div className="member-global-error"><Alert tone="error">{logoutError}</Alert></div>}
      <main id="member-content" className="member-content skip-focus-target" tabIndex={-1} key={state.session.user.id}>{children}</main>
      <footer className="member-footer"><BrandLockup /><span>© {new Date().getFullYear()} Weylume</span></footer>
    </div>
  );
}

export function AuthenticatedMemberPage({ children }: { children: ReactNode }) {
  return <MemberLayout>{children}</MemberLayout>;
}
