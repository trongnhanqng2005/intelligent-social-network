import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, AtSign, RefreshCw } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router';
import { AuthApiError } from '../api/auth-api';
import { useAuth } from '../model/auth-context';
import { AuthShell } from './auth-shell';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { PasswordField } from '../../../shared/ui/password-field';

function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { state, login, register, retry } = useAuth();
  const navigate = useNavigate();
  const errorSummary = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [errorAnnouncement, setErrorAnnouncement] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error, errorAnnouncement]);

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setFieldErrors({});
    if (mode === 'register' && password !== confirmation) {
      setError('Mật khẩu xác nhận chưa khớp.');
      setErrorAnnouncement((current) => current + 1);
      return;
    }

    setPending(true);
    try {
      if (mode === 'register') {
        await register(email, password);
        setNotice('Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.');
        setPassword('');
        setConfirmation('');
      } else {
        await login(email, password);
        navigate('/', { replace: true });
      }
    } catch (cause) {
      if (cause instanceof AuthApiError) {
        setError(cause.code === 'CSRF_FAILED'
          ? 'Phiên xác minh đã thay đổi. Vui lòng gửi lại biểu mẫu.'
          : cause.message);
        setErrorAnnouncement((current) => current + 1);
        setFieldErrors(cause.fieldErrors ?? {});
      } else {
        setError('Không thể hoàn tất yêu cầu. Vui lòng thử lại.');
        setErrorAnnouncement((current) => current + 1);
      }
    } finally {
      setPending(false);
    }
  }

  const title = mode === 'login' ? 'Chào mừng bạn trở lại' : 'Tạo tài khoản mới';
  const description = mode === 'login'
    ? 'Đăng nhập để tiếp tục hành trình kết nối của bạn.'
    : 'Bắt đầu từ những điều bạn quan tâm.';

  return (
    <AuthShell mode={mode}>
      <span className="auth-kicker">{mode === 'login' ? 'RẤT VUI ĐƯỢC GẶP LẠI' : 'CHÀO MỪNG ĐẾN VỚI WEYLUME'}</span>
      <h1 id="auth-title">{title}</h1>
      <p className="auth-description">{description}</p>
      {state.status === 'unavailable' && <div className="unavailable-feedback"><Alert tone="error">Dịch vụ đăng nhập hiện chưa khả dụng.</Alert><Button variant="ghost" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> Thử kết nối lại</Button></div>}
      {error && <div className="form-error-summary" role="alert" tabIndex={-1} ref={errorSummary}>
        <strong>Chưa thể gửi biểu mẫu</strong><p>{error}</p>
        {Object.entries(fieldErrors).map(([field, messages]) => {
          const id = field === 'email' ? 'auth-email' : 'auth-password';
          const label = field === 'email' ? 'Địa chỉ email' : 'Mật khẩu';
          return messages[0] ? <p key={field}><a href={`#${id}`}>{label}: {messages[0]}</a></p> : null;
        })}
      </div>}
      {notice && <Alert tone="success">{notice} <Link to="/dang-nhap">Đăng nhập</Link></Alert>}
      <form className="auth-form skip-focus-target" id="auth-form" tabIndex={-1} onSubmit={submit} noValidate>
        <div className="form-field">
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
        </div>

        <PasswordField
          id="auth-password"
          label="Mật khẩu"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={setPassword}
          hint={mode === 'register' ? 'Mật khẩu từ 15 đến 128 ký tự.' : undefined}
          error={fieldErrors.password?.[0]}
        />
        {mode === 'register' && <PasswordField
          id="auth-confirm-password"
          label="Xác nhận mật khẩu"
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
          error={error === 'Mật khẩu xác nhận chưa khớp.' ? error : undefined}
        />}

        <Button className="submit-button" type="submit" pending={pending} pendingLabel="Đang xử lý…" disabled={state.status === 'unavailable'}>
          {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'} <ArrowRight aria-hidden="true" size={18} />
        </Button>
      </form>
      {mode === 'register' && <p className="privacy-note">Email và mật khẩu dùng để đăng nhập.</p>}
      {mode === 'login' && <Link className="back-home-link" to="/">Quay về trang chủ</Link>}
    </AuthShell>
  );
}

export function LoginPage() { return <AuthForm mode="login" />; }
export function RegisterPage() { return <AuthForm mode="register" />; }
