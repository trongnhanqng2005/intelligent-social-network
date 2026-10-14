import { Link } from 'react-router';
import { BrandLockup } from '../../../shared/brand/brand-lockup';

function AuthArtwork({ mode }: { mode: 'login' | 'register' }) {
  return mode === 'register' ? (
    <svg className="auth-art auth-art--register" viewBox="0 0 520 360" aria-hidden="true">
      <defs>
        <linearGradient id="welcome-scene" x1="55" y1="16" x2="468" y2="344" gradientUnits="userSpaceOnUse"><stop stopColor="#fffefa" /><stop offset="1" stopColor="#e5f2eb" /></linearGradient>
        <linearGradient id="welcome-door" x1="260" y1="34" x2="260" y2="285" gradientUnits="userSpaceOnUse"><stop stopColor="#d8eee4" /><stop offset="1" stopColor="#bddfd1" /></linearGradient>
      </defs>
      <rect x="12" y="12" width="496" height="336" rx="30" fill="url(#welcome-scene)" stroke="#d8e2df" />
      <path d="M116 287V164a144 144 0 0 1 288 0v123z" fill="url(#welcome-door)" />
      <path d="M148 287V165a112 112 0 0 1 224 0v122" fill="none" stroke="#a9cdbd" strokeWidth="2" />
      <path d="M261 48v239" stroke="#a9cdbd" strokeWidth="2" />
      <circle cx="344" cy="94" r="24" fill="#f0d7b8" />
      <path d="M50 294h420" stroke="#b9d0c5" strokeWidth="2" />
      <path d="M89 292q8-69 61-72 56 3 64 72z" fill="#c98d68" />
      <path d="M309 292q9-73 63-72 57 3 64 72z" fill="#346a61" />
      <path d="M206 292q8-88 56-91 52 3 58 91z" fill="#d4ad78" />
      <path d="M127 178c0-24 13-40 31-40s33 16 33 40-14 37-33 37-31-13-31-37" fill="#e9bd98" />
      <path d="M125 175c-4-27 10-47 33-48 20-1 34 14 35 34-12-3-22-12-26-23-9 15-23 24-42 25z" fill="#3e564d" />
      <path d="M330 178c0-24 13-40 31-40s33 16 33 40-14 37-33 37-31-13-31-37" fill="#8d5f4b" />
      <path d="M328 172c1-25 15-44 35-44 21 0 34 16 33 37-11-3-19-10-23-20-9 14-24 22-45 23z" fill="#273f3b" />
      <path d="M235 163c0-25 13-41 31-41s32 16 32 41-14 38-32 38-31-13-31-38" fill="#f0c9a8" />
      <path d="M233 158c-2-26 12-44 34-45 20-1 32 13 33 33-13-3-22-11-26-22-8 14-22 22-41 24z" fill="#6b5145" />
      <path d="M183 244q28-14 52 1m70-1q24-15 49-1" fill="none" stroke="#e9bd98" strokeLinecap="round" strokeWidth="13" />
      <path d="M259 265v22" stroke="#9c7d5b" strokeLinecap="round" strokeWidth="8" />
      <path d="M226 287h68" stroke="#9c7d5b" strokeLinecap="round" strokeWidth="8" />
      <path d="M259 275q-15-15-24-4 8 17 24 14 16 3 24-14-9-11-24 4" fill="#7aa58f" />
    </svg>
  ) : (
    <svg className="auth-art auth-art--login" viewBox="0 0 520 360" aria-hidden="true">
      <defs>
        <linearGradient id="return-scene" x1="45" y1="16" x2="470" y2="344" gradientUnits="userSpaceOnUse"><stop stopColor="#fffefa" /><stop offset="1" stopColor="#e5f2eb" /></linearGradient>
        <linearGradient id="return-window" x1="260" y1="35" x2="260" y2="275" gradientUnits="userSpaceOnUse"><stop stopColor="#e7f3ed" /><stop offset="1" stopColor="#d7ebe1" /></linearGradient>
      </defs>
      <rect x="12" y="12" width="496" height="336" rx="30" fill="url(#return-scene)" stroke="#d8e2df" />
      <path d="M121 277V157a139 139 0 0 1 278 0v120z" fill="url(#return-window)" />
      <path d="M151 277V158a109 109 0 0 1 218 0v119" fill="none" stroke="#b5d3c5" strokeWidth="2" />
      <path d="M82 298h356" stroke="#b9d0c5" strokeWidth="2" />
      <circle cx="357" cy="91" r="24" fill="#f0d7b8" />
      <path d="M86 292q8-70 61-72 56 2 64 72z" fill="#346a61" />
      <path d="M310 292q8-70 61-72 56 2 64 72z" fill="#c98d68" />
      <path d="M120 170c0-24 13-40 31-40s33 16 33 40-14 37-33 37-31-13-31-37" fill="#8d5f4b" />
      <path d="M118 164c1-25 15-44 35-44 21 0 34 16 33 37-11-3-19-10-23-20-9 14-24 22-45 23z" fill="#273f3b" />
      <path d="M334 170c0-24 13-40 31-40s33 16 33 40-14 37-33 37-31-13-31-37" fill="#f0c9a8" />
      <path d="M332 165c-3-26 11-45 34-46 20-1 33 14 34 34-12-3-22-12-26-23-9 15-23 24-42 25z" fill="#6b5145" />
      <path d="M175 243q41 24 83 0m0 0q42 24 83 0" fill="none" stroke="#e9bd98" strokeLinecap="round" strokeWidth="13" />
      <ellipse cx="260" cy="257" rx="125" ry="25" fill="#f8f4e9" stroke="#b9d0c5" strokeWidth="2" />
      <path d="m202 278 11 30m105-30-11 30" stroke="#9c7d5b" strokeLinecap="round" strokeWidth="8" />
      <path d="M247 241h22v10q0 9-11 9t-11-9z" fill="#d2a276" />
      <path d="M294 235h20v15h-20z" fill="#fffefa" stroke="#6a8b7e" strokeWidth="2" />
    </svg>
  );
}

export function AuthShell({ children, mode }: { children: React.ReactNode; mode: 'login' | 'register' }) {
  return (
    <main className="auth-page">
      <a className="skip-link" href="#auth-form">Đi đến biểu mẫu</a>
      <header className="auth-topbar">
        <BrandLockup />
        <Link className="auth-home-link" to="/">Về trang chủ</Link>
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
        <aside className={`auth-aside auth-aside--${mode}`} aria-label="Tinh thần Weylume">
          <div className="aside-copy"><span className="eyebrow">MỌI KẾT NỐI ĐỀU CÓ Ý NGHĨA</span><h2>{mode === 'login' ? 'Niềm vui gặp lại bạn.' : 'Cùng mở ra những kết nối mới.'}</h2><p>Những điểm chung nhỏ bé có thể mở đầu cho những điều đáng quý.</p></div>
          <AuthArtwork mode={mode} />
          <p className="aside-caption">Weylume · Kết nối bắt đầu từ sự quan tâm</p>
        </aside>
      </div>
      <footer className="auth-footer">© {new Date().getFullYear()} Weylume</footer>
    </main>
  );
}
