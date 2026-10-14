import { useState } from 'react';
import { ArrowDown, ArrowRight, Compass, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../features/auth/model/auth-context';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { BrandLockup } from '../../shared/brand/brand-lockup';

function WeylumeHeroArt() {
  return (
    <svg className="hero-art hero-art--desktop" viewBox="0 0 640 520" role="img" aria-labelledby="hero-art-title">
      <title id="hero-art-title">Ba người cùng trò chuyện quanh một chiếc bàn</title>
      <defs>
        <linearGradient id="gathering-paper" x1="80" y1="24" x2="560" y2="500" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fffefa" /><stop offset="1" stopColor="#e8f3ed" />
        </linearGradient>
        <linearGradient id="gathering-arch" x1="320" y1="70" x2="320" y2="390" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e3f3ec" /><stop offset="1" stopColor="#d4eae0" />
        </linearGradient>
      </defs>
      <rect x="12" y="12" width="616" height="496" rx="34" fill="url(#gathering-paper)" stroke="#d8e2df" />
      <path d="M124 388V222a196 196 0 0 1 392 0v166z" fill="url(#gathering-arch)" />
      <path d="M154 388V224a166 166 0 0 1 332 0v164" fill="none" stroke="#c6dfd4" strokeWidth="2" />
      <circle cx="492" cy="119" r="34" fill="#f0d7b8" />
      <path d="M68 388h504" stroke="#b9d0c5" strokeWidth="2" />
      <path d="M127 333v-42q0-13 13-13h31q13 0 13 13v42m273 0v-42q0-13 13-13h31q13 0 13 13v42" fill="none" stroke="#6a8b7e" strokeLinecap="round" strokeWidth="8" />

      <path d="M84 378q11-88 86-94 71 3 87 94z" fill="#c98d68" />
      <path d="M394 378q14-94 82-94 72 5 81 94z" fill="#346a61" />
      <path d="M248 376q8-111 72-116 66 4 73 116z" fill="#d4ad78" />

      <path d="M140 226c0-31 17-52 42-52 27 0 43 22 43 52 0 29-18 49-43 49s-42-20-42-49" fill="#e9bd98" />
      <path d="M138 223c-7-34 12-63 43-65 27-2 45 17 48 42-15-3-28-14-34-29-12 19-31 31-57 33z" fill="#3e564d" />
      <path d="M152 231q5-4 10 0m28 0q5-4 10 0m-31 18q8 7 17 0" fill="none" stroke="#6b5145" strokeLinecap="round" strokeWidth="2.5" />

      <path d="M428 226c0-31 17-52 42-52 27 0 43 22 43 52 0 29-18 49-43 49s-42-20-42-49" fill="#8d5f4b" />
      <path d="M426 218c1-31 18-55 46-56 28-1 43 20 42 48-13-3-22-13-26-24-12 16-33 25-62 25z" fill="#273f3b" />
      <path d="M440 231q5-4 10 0m28 0q5-4 10 0m-31 18q8 7 17 0" fill="none" stroke="#563e35" strokeLinecap="round" strokeWidth="2.5" />

      <path d="M282 213c0-31 16-53 39-53 25 0 40 22 40 53 0 30-16 49-40 49s-39-19-39-49" fill="#f0c9a8" />
      <path d="M280 211c-4-31 12-57 40-59 26-2 42 16 43 42-18-4-31-15-37-30-10 19-24 29-46 33z" fill="#6b5145" />
      <path d="M293 218q5-4 10 0m26 0q5-4 10 0m-28 19q7 6 14 0" fill="none" stroke="#765347" strokeLinecap="round" strokeWidth="2.5" />

      <path d="M205 320q45 34 91 22m137-22q-44 34-91 22" fill="none" stroke="#e9bd98" strokeLinecap="round" strokeWidth="15" />
      <ellipse cx="320" cy="371" rx="196" ry="39" fill="#f8f4e9" stroke="#b9d0c5" strokeWidth="2" />
      <path d="m190 392 17 54m243-54-17 54" stroke="#9c7d5b" strokeLinecap="round" strokeWidth="12" />
      <path d="M283 359h19v9q0 8-9 8t-10-8z" fill="#d2a276" />
      <rect x="337" y="350" width="26" height="18" rx="5" fill="#fffefa" stroke="#6a8b7e" strokeWidth="2" />
      <path d="M363 354q14-1 9 12h-9" fill="none" stroke="#6a8b7e" strokeWidth="2" />
      <path d="M313 342h14" stroke="#0f766e" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

function WeylumeMobileArt() {
  return (
    <svg className="hero-art hero-art--mobile" viewBox="0 0 360 300" aria-hidden="true">
      <defs>
        <linearGradient id="mobile-gathering-paper" x1="40" y1="0" x2="320" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#fffefa" /><stop offset="1" stopColor="#e5f2eb" /></linearGradient>
      </defs>
      <rect x="5" y="5" width="350" height="290" rx="28" fill="url(#mobile-gathering-paper)" stroke="#d8e2df" />
      <path d="M68 251V146a112 112 0 0 1 224 0v105z" fill="#dcefe6" />
      <circle cx="285" cy="70" r="19" fill="#f0d7b8" />
      <path d="M24 251h312" stroke="#b9d0c5" strokeWidth="2" />
      <path d="M52 248q7-57 53-59 46 2 55 59z" fill="#c98d68" />
      <path d="M200 248q8-60 54-59 48 3 54 59z" fill="#346a61" />
      <path d="M80 145c0-22 12-37 29-37s29 15 29 37-12 34-29 34-29-12-29-34" fill="#e9bd98" />
      <path d="M79 142c-4-24 9-43 30-44 18-1 30 12 31 29-11-2-19-10-23-20-8 13-20 21-38 23z" fill="#3e564d" />
      <path d="M218 145c0-22 12-37 29-37s29 15 29 37-12 34-29 34-29-12-29-34" fill="#8d5f4b" />
      <path d="M217 139c1-22 13-39 31-39s30 15 29 34c-9-2-16-9-19-17-8 11-21 18-41 18z" fill="#273f3b" />
      <ellipse cx="180" cy="244" rx="105" ry="23" fill="#f8f4e9" stroke="#b9d0c5" strokeWidth="2" />
      <path d="M161 234h18v9q0 7-9 7t-9-7z" fill="#d2a276" />
      <path d="M195 226h18v16h-18z" fill="#fffefa" stroke="#6a8b7e" strokeWidth="2" />
    </svg>
  );
}

const values = [
  { number: '01', title: 'Bắt đầu từ sự chân thành', copy: 'Một cộng đồng ý nghĩa được nuôi dưỡng bằng những cuộc gặp gỡ và sự quan tâm thật lòng.' },
  { number: '02', title: 'Mỗi người đều có chỗ riêng', copy: 'Weylume hướng đến một không gian cởi mở, nơi mỗi cá tính được đón nhận.' },
  { number: '03', title: 'Kết nối theo cách của bạn', copy: 'Hãy bắt đầu từ điều bạn quan tâm và để những điểm chung mở ra cuộc trò chuyện.' },
];

export function HomePage() {
  const { state, logout, retry } = useAuth();
  const [pending, setPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');

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
    <div className="home-shell">
      <a className="skip-link" href="#noi-dung">Đi đến nội dung chính</a>
      <header className="site-header">
        <BrandLockup />
        <nav className="home-nav" aria-label="Điều hướng chính">
          <a href="#gioi-thieu">Giới thiệu</a>
          <a href="#gia-tri">Giá trị</a>
        </nav>
        <div className="account-nav">
          {state.status === 'authenticated' ? (
            <>
              <Link className="home-member-link" to="/ho-so"><UserRound size={16} aria-hidden="true" /> Hồ sơ của tôi</Link>
              <Link className="home-member-link" to="/kham-pha"><Compass size={16} aria-hidden="true" /> Khám phá</Link>
              <Button variant="ghost" pending={pending} pendingLabel="Đang đăng xuất…" onClick={handleLogout}>
                <LogOut size={17} aria-hidden="true" /> Đăng xuất
              </Button>
            </>
          ) : state.status === 'loading' ? (
            <span className="session-check" role="status">Đang kiểm tra phiên…</span>
          ) : (
            <><Link className="login-link" to="/dang-nhap">Đăng nhập</Link><Link className="ui-button ui-button--primary header-cta" to="/dang-ky">Tạo tài khoản <ArrowRight size={17} aria-hidden="true" /></Link></>
          )}
        </div>
      </header>

      <main className="skip-focus-target" id="noi-dung" tabIndex={-1}>
        <section className="hero-section page-container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow">WEYLUME · CỘNG ĐỒNG CỦA NHỮNG KẾT NỐI</span>
            {state.status === 'authenticated' ? (
              <>
                <h1 id="hero-title">Chào mừng bạn trở lại.</h1>
                <p className="hero-lede">Mỗi kết nối ý nghĩa đều bắt đầu từ một cuộc trò chuyện chân thành.</p>
                <div className="identity-card"><span className="identity-initial" aria-hidden="true">{state.session.user.email.slice(0, 1).toUpperCase()}</span><span><small>Đang đăng nhập với</small><strong>{state.session.user.email}</strong></span></div>
                {logoutError && <Alert tone="error">{logoutError}</Alert>}
                {logoutError && <Button variant="secondary" onClick={handleLogout}>Thử đăng xuất lại</Button>}
              </>
            ) : (
              <>
                <h1 id="hero-title">Kết nối có ý nghĩa, <span>bắt đầu từ bạn.</span></h1>
                <p className="hero-lede">Weylume là nơi những mối quan tâm chung có thể mở đầu cho sự thấu hiểu và những mối quan hệ mới.</p>
                {state.status !== 'loading' && <div className="hero-actions">
                  <Link className="ui-button ui-button--primary hero-cta" to="/dang-ky">Tạo tài khoản <ArrowRight size={18} aria-hidden="true" /></Link>
                  <a className="ui-button ui-button--secondary" href="#gioi-thieu">Tìm hiểu thêm <ArrowDown size={17} aria-hidden="true" /></a>
                </div>}
                {state.status === 'unavailable' && <div className="session-unavailable"><Alert tone="info">Chưa thể xác minh phiên đăng nhập.</Alert><Button variant="ghost" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> Thử lại</Button></div>}
              </>
            )}
          </div>
          <div className="hero-art-wrap"><WeylumeHeroArt /><WeylumeMobileArt /></div>
        </section>

        <section className="intro-section" id="gioi-thieu" aria-labelledby="intro-title">
          <div className="page-container intro-grid">
            <div><span className="eyebrow">MỘT KHỞI ĐẦU GẦN GŨI</span><h2 id="intro-title">Điều khiến chúng ta gần nhau thường bắt đầu từ một điểm chung.</h2></div>
            <p>Weylume được tạo nên với niềm tin rằng những kết nối có ý nghĩa bắt đầu bằng việc lắng nghe, sẻ chia và khám phá những điều chúng ta cùng quan tâm.</p>
          </div>
        </section>

        <section className="values-section page-container" id="gia-tri" aria-labelledby="values-title">
          <div className="section-heading"><span className="eyebrow">ĐIỀU WEYLUME TRÂN TRỌNG</span><h2 id="values-title">Kết nối, bằng sự quan tâm.</h2><p>Một cộng đồng tốt đẹp bắt đầu từ cách chúng ta hiện diện cùng nhau.</p></div>
          <div className="values-grid">{values.map((value) => <article className="value-card" key={value.number}><span className="value-number">{value.number}</span><h3>{value.title}</h3><p>{value.copy}</p></article>)}</div>
        </section>

        {state.status === 'anonymous' || state.status === 'unavailable' ? <section className="closing-section page-container" aria-labelledby="closing-title"><div className="closing-panel"><span className="eyebrow">WEYLUME</span><h2 id="closing-title">Một kết nối ý nghĩa có thể bắt đầu từ hôm nay.</h2><Link className="ui-button ui-button--primary" to="/dang-ky">Tạo tài khoản <ArrowRight size={17} aria-hidden="true" /></Link></div></section> : null}
      </main>

      <footer className="site-footer"><div className="page-container footer-inner"><BrandLockup /><span>© {new Date().getFullYear()} Weylume</span><nav aria-label="Liên kết cuối trang"><a href="#gioi-thieu">Giới thiệu</a>{state.status === 'anonymous' || state.status === 'unavailable' ? <><Link to="/dang-nhap">Đăng nhập</Link><Link to="/dang-ky">Tạo tài khoản</Link></> : null}</nav></div></footer>
    </div>
  );
}
