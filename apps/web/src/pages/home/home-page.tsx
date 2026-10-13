import { Link } from 'react-router';
import { ArrowRight, LogOut, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../features/auth/model/auth-context';
import { ConnectedNodesMark } from '../../features/auth/ui/connected-nodes-mark';
import { useApiHealth } from './model/use-api-health';

export function HomePage() {
  const { state, logout, retry } = useAuth();
  const { state: apiState, retry: retryApi } = useApiHealth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleLogout() {
    setPending(true);
    setError('');
    try {
      await logout();
    } catch {
      setError('Không thể đăng xuất lúc này. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="home-shell">
      <header className="site-header">
        <Link className="brand-lockup" to="/" aria-label="Connected Nodes — Trang chủ">
          <ConnectedNodesMark className="brand-mark" />
          <span>Intelligent Social Network</span>
        </Link>
        {state.status === 'authenticated' ? (
          <button className="text-button" type="button" disabled={pending} onClick={handleLogout}>
            {pending ? <LoaderCircle className="spinner" size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
            Đăng xuất
          </button>
        ) : (
          <nav className="home-nav" aria-label="Tài khoản">
            <Link to="/dang-nhap">Đăng nhập</Link>
            <Link className="nav-cta" to="/dang-ky">Tạo tài khoản <ArrowRight size={16} aria-hidden="true" /></Link>
          </nav>
        )}
      </header>

      <main className="welcome-main">
        <div className="welcome-copy">
          <span className="eyebrow">MỘT CỘNG ĐỒNG, NHIỀU KẾT NỐI</span>
          {state.status === 'authenticated' ? (
            <>
              <h1>Chào mừng trở lại, <span>{state.session.user.email}</span></h1>
              <p>Phiên đăng nhập của bạn đang hoạt động. Hành trình kết nối sẽ sớm bắt đầu tại đây.</p>
              <button className="text-button logout-inline" type="button" disabled={pending} onClick={handleLogout}>
                {pending ? 'Đang đăng xuất…' : 'Đăng xuất'}
              </button>
            </>
          ) : state.status === 'loading' ? (
            <><h1>Đang kiểm tra phiên của bạn…</h1><p role="status">Vui lòng chờ trong giây lát.</p></>
          ) : state.status === 'unavailable' ? (
            <><h1>Kết nối bắt đầu từ những điều giản dị.</h1><p role="status">Dịch vụ đăng nhập hiện chưa khả dụng. Vui lòng thử lại.</p><button className="text-button" type="button" onClick={retry}><RefreshCw size={17} aria-hidden="true" /> Thử kết nối lại</button></>
          ) : (
            <><h1>Kết nối bắt đầu từ những điều giản dị.</h1><p>Một không gian cộng đồng đang được xây dựng để giúp mọi người tìm thấy những kết nối có ý nghĩa.</p><Link className="submit-button welcome-cta" to="/dang-ky">Bắt đầu kết nối <ArrowRight size={18} aria-hidden="true" /></Link></>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
        <div className="welcome-art-wrap" aria-hidden="true">
          <svg className="welcome-art" viewBox="0 0 620 470" fill="none">
            <circle cx="310" cy="235" r="174" fill="#ccfbf1" opacity=".68" />
            <circle cx="310" cy="235" r="127" fill="white" />
            <path d="M104 234c72-120 151-123 206 1 55 123 133 120 206-1M106 248c72 121 150 123 204-1 55-124 134-121 204 1" stroke="#5eead4" strokeWidth="2" strokeDasharray="5 9" />
            <circle cx="310" cy="196" r="31" fill="#0f766e" /><path d="M249 294c7-39 28-58 61-58s54 19 61 58" fill="#14b8a6" />
            <circle cx="178" cy="149" r="23" fill="#99f6e4" /><path d="M136 212c5-28 19-42 42-42s37 14 42 42" fill="#0f766e" />
            <circle cx="442" cy="149" r="23" fill="#5eead4" /><path d="M400 212c5-28 19-42 42-42s37 14 42 42" fill="#115e59" />
            <circle cx="178" cy="319" r="23" fill="#5eead4" /><path d="M136 382c5-28 19-42 42-42s37 14 42 42" fill="#115e59" />
            <circle cx="442" cy="319" r="23" fill="#99f6e4" /><path d="M400 382c5-28 19-42 42-42s37 14 42 42" fill="#0f766e" />
          </svg>
          <div className="art-note"><ConnectedNodesMark className="caption-mark" /><span>Mỗi kết nối đều có ý nghĩa.</span></div>
        </div>
      </main>
      <section className="api-health-card" aria-label="Kết nối API" aria-busy={apiState.status === 'loading'}>
        <div className="api-health-copy">
          <span className={`api-status api-status--${apiState.status}`}>
            <span aria-hidden="true" className="api-status-dot" />
            {apiState.status === 'loading' ? 'Đang kiểm tra' : apiState.status === 'success' ? 'Đã kết nối' : 'Không khả dụng'}
          </span>
          <h2>Kết nối dịch vụ</h2>
          <p role={apiState.status === 'error' ? 'alert' : 'status'}>
            {apiState.status === 'loading' ? 'Đang kiểm tra kết nối API.' : apiState.status === 'success' ? 'API đang hoạt động bình thường.' : apiState.message}
          </p>
        </div>
        <div className="health-action">
          <code>GET /health</code>
          {apiState.status === 'error' && <button className="text-button" type="button" onClick={retryApi}>Thử kết nối lại</button>}
        </div>
      </section>
      <footer className="page-footer"><span>© Intelligent Social Network</span><span>Đang trong giai đoạn phát triển</span></footer>
    </div>
  );
}
