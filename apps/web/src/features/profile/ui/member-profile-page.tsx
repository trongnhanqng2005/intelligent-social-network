import { useEffect, useState } from 'react';
import { ArrowLeft, MapPin, UserRound } from 'lucide-react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { getMemberProfile, UserApiError, type PublicProfile } from '../api/profile-api';
import { ProfileAvatar } from './profile-avatar';
import { FriendshipActions } from '../../friendships/ui/friendship-actions';

export function MemberProfilePage() {
  const { id = '' } = useParams();
  const { state } = useAuth();
  const location = useLocation();
  const [profile, setProfile] = useState<PublicProfile>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!id || (state.status === 'authenticated' && state.session.user.id === id)) return;
    const controller = new AbortController();
    setLoading(true);
    setNotFound(false);
    setError(false);
    getMemberProfile(id, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setProfile(value);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof UserApiError && cause.status === 404) setNotFound(true);
      else setError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [id, retry, state]);

  if (state.status === 'authenticated' && id === state.session.user.id) return <Navigate to="/ho-so" replace />;
  const from = safeReturnPath(location.state);

  return (
    <section className="profile-page" aria-labelledby="member-profile-title">
      <Link className="member-profile-back" to={from}><ArrowLeft size={17} aria-hidden="true" /> {from.startsWith('/ban-be') ? 'Quay lại danh sách' : 'Quay lại khám phá'}</Link>
      {loading && <p role="status">Đang tải hồ sơ thành viên…</p>}
      {notFound && <div className="profile-error-state"><h1 id="member-profile-title">Không tìm thấy hồ sơ</h1><Alert tone="info">Thành viên này không tồn tại hoặc hồ sơ không còn khả dụng.</Alert></div>}
      {error && <div className="profile-error-state"><h1 id="member-profile-title">Chưa thể tải hồ sơ</h1><Alert tone="error">Dịch vụ đang tạm thời không khả dụng.</Alert><Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Thử lại</Button></div>}
      {!loading && !notFound && !error && profile && <>
        <header className="profile-heading"><span className="profile-eyebrow">THÀNH VIÊN WEYLUME</span><h1 id="member-profile-title">Hồ sơ thành viên</h1></header>
        <article className="profile-card">
          <div className="profile-identity"><ProfileAvatar name={profile.displayName} /><div><h2>{profile.displayName}</h2><p><UserRound size={14} aria-hidden="true" /> Thành viên Weylume</p></div></div>
          <dl className="profile-readonly">
            <div><dt>Giới thiệu</dt><dd>{profile.bio || 'Chưa có giới thiệu.'}</dd></div>
            <div><dt>Địa điểm</dt><dd>{profile.location ? <><MapPin size={15} aria-hidden="true" /> {profile.location}</> : 'Chưa thêm địa điểm.'}</dd></div>
          </dl>
          <FriendshipActions memberId={profile.id} />
        </article>
      </>}
    </section>
  );
}

function safeReturnPath(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state) ||
      typeof state.from !== 'string' || state.from.includes('\\')) return '/kham-pha';
  try {
    const destination = new URL(state.from, 'https://weylume.invalid');
    if (destination.origin !== 'https://weylume.invalid' ||
        !['/kham-pha', '/ban-be', '/ban-be/loi-moi'].includes(destination.pathname)) {
      return '/kham-pha';
    }
    return `${destination.pathname}${destination.search}`;
  } catch {
    return '/kham-pha';
  }
}
