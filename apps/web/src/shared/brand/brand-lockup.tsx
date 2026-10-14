import { Link } from 'react-router';
import { WeylumeMark } from './weylume-mark';

export function BrandLockup() {
  return (
    <Link className="brand-lockup" to="/" aria-label="Weylume — Trang chủ">
      <WeylumeMark className="brand-mark" />
      <span>Weylume</span>
    </Link>
  );
}
