import { Link, useLocation } from 'react-router';
import { ProfileAvatar } from './profile-avatar';
import type { PublicProfile } from '../api/profile-api';

export function MemberCard({ profile }: { profile: PublicProfile }) {
  const location = useLocation();
  return (
    <article className="member-card">
      <ProfileAvatar name={profile.displayName} size="small" />
      <div className="member-card-body">
        <h2><Link to={`/thanh-vien/${encodeURIComponent(profile.id)}`} state={{ from: `${location.pathname}${location.search}` }}>{profile.displayName}</Link></h2>
        {profile.bio && <p>{profile.bio}</p>}
        {profile.location && <p>{profile.location}</p>}
      </div>
    </article>
  );
}
