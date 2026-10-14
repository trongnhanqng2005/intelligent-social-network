import { Link } from 'react-router';
import { BrandLockup } from '../../shared/brand/brand-lockup';

export function NotFoundPage() {
  return (
    <div className="not-found-page">
      <header><BrandLockup /></header>
      <main className="not-found-content">
        <span className="eyebrow">404 · LẠC MỘT NHỊP</span>
        <h1>Trang này chưa có ở đây.</h1>
        <p>Địa chỉ có thể đã thay đổi. Hãy quay lại Weylume để tiếp tục.</p>
        <Link className="ui-button ui-button--primary" to="/">Quay về trang chủ</Link>
      </main>
      <footer className="auth-footer">© {new Date().getFullYear()} Weylume</footer>
    </div>
  );
}
