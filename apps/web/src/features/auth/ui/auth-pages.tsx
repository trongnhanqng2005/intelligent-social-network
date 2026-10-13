import { useState, type FormEvent } from 'react';
import { ArrowRight, AtSign, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router';
import { AuthApiError } from '../api/auth-api';
import { useAuth } from '../model/auth-context';
import { AuthShell } from './auth-shell';

function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { state, login, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    setFieldErrors({});
    try {
      if (mode === 'register') {
        await register(email, password);
        setNotice('Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.');
        setPassword('');
      } else {
        await login(email, password);
        navigate('/', { replace: true });
      }
    } catch (cause) {
      if (cause instanceof AuthApiError) {
        setError(cause.code === 'CSRF_FAILED'
          ? 'Phiên xác minh đã thay đổi. Vui lòng gửi lại biểu mẫu.'
          : cause.message);
        setFieldErrors(cause.fieldErrors ?? {});
      } else {
        setError('Không thể hoàn tất yêu cầu. Vui lòng thử lại.');
      }
    } finally {
      setPending(false);
    }
  }

  const title = mode === 'login' ? 'Chào mừng bạn trở lại' : 'Tạo tài khoản mới';
  const description = mode === 'login'
    ? 'Đăng nhập để tiếp tục kết nối với cộng đồng.'
    : 'Bắt đầu hành trình kết nối của bạn hôm nay.';

  return (
    <AuthShell mode={mode}>
      <span className="auth-kicker">{mode === 'login' ? 'RẤT VUI ĐƯỢC GẶP LẠI' : 'THAM GIA CỘNG ĐỒNG'}</span>
      <h1 id="auth-title">{title}</h1>
      <p className="auth-description">{description}</p>
      {state.status === 'unavailable' && (
        <div className="form-alert form-alert--error" role="alert">
          Dịch vụ hiện chưa khả dụng. Vui lòng thử lại sau.
        </div>
      )}
      {error && <div className="form-alert form-alert--error" role="alert">{error}</div>}
      {notice && <div className="form-alert form-alert--success" role="status">{notice}</div>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <label htmlFor="auth-email">Địa chỉ email</label>
        <div className={`input-wrap ${fieldErrors.email ? 'input-wrap--invalid' : ''}`}>
          <AtSign aria-hidden="true" size={19} />
          <input
            autoComplete="email"
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            placeholder="ban@example.com"
          />
        </div>
        {fieldErrors.email?.length ? <p className="field-error" id="email-error">{fieldErrors.email[0]}</p> : null}

        <label htmlFor="auth-password">Mật khẩu</label>
        <div className={`input-wrap ${fieldErrors.password ? 'input-wrap--invalid' : ''}`}>
          <KeyRound aria-hidden="true" size={19} />
          <input
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            id="auth-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            minLength={15}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error password-hint' : 'password-hint'}
            placeholder="Nhập mật khẩu"
          />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
          </button>
        </div>
        {fieldErrors.password?.length ? <p className="field-error" id="password-error">{fieldErrors.password[0]}</p> : null}
        <p className="field-hint" id="password-hint">Mật khẩu từ 15 đến 128 ký tự.</p>

        <button className="submit-button" type="submit" disabled={pending || state.status === 'unavailable'}>
          {pending ? <><LoaderCircle className="spinner" aria-hidden="true" size={19} /> Đang xử lý…</> : <>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'} <ArrowRight aria-hidden="true" size={18} /></>}
        </button>
      </form>
      {mode === 'register' && <p className="privacy-note">Thông tin của bạn được bảo vệ và chỉ dùng để tạo tài khoản.</p>}
      {mode === 'login' && <Link className="back-home-link" to="/">Quay về trang chủ</Link>}
    </AuthShell>
  );
}

export function LoginPage() { return <AuthForm mode="login" />; }
export function RegisterPage() { return <AuthForm mode="register" />; }
