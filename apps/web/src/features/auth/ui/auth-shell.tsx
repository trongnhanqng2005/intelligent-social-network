import { Link } from 'react-router';
import { ConnectedNodesMark } from './connected-nodes-mark';
import { CommunityIllustration } from './community-illustration';

export function AuthShell({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: 'login' | 'register';
}) {
  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Link className="brand-lockup" to="/" aria-label="Connected Nodes — Trang chủ">
          <ConnectedNodesMark className="brand-mark" />
          <span>Intelligent Social Network</span>
        </Link>
        <span className="auth-topbar-note">Kết nối bắt đầu từ đây</span>
      </header>
      <div className="auth-content">
        <section className="auth-card" aria-labelledby="auth-title">
          {children}
          <p className="auth-switch">
            {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
            <Link to={mode === 'login' ? '/dang-ky' : '/dang-nhap'}>
              {mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}
            </Link>
          </p>
        </section>
        <aside className="auth-aside" aria-label="Giới thiệu cộng đồng">
          <div className="aside-copy">
            <span className="eyebrow">Cùng tạo nên kết nối</span>
            <h2>Nơi những mối quan hệ bắt đầu.</h2>
            <p>Một không gian để bạn kết nối với cộng đồng theo cách của riêng mình.</p>
          </div>
          <CommunityIllustration />
          <div className="aside-caption"><ConnectedNodesMark className="caption-mark" /><span>Mỗi kết nối đều có ý nghĩa.</span></div>
        </aside>
      </div>
      <footer className="auth-footer">© Intelligent Social Network · Đang trong giai đoạn phát triển</footer>
    </main>
  );
}
