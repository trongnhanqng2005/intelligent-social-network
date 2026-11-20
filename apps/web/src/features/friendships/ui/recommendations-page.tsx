import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FriendshipActions } from './friendship-actions';
import { getFriendRecommendations, type FriendRecommendation } from '../api/recommendations-api';
import './friendships.css';

export function RecommendationsPage() {
  const [items, setItems] = useState<FriendRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [invitedName, setInvitedName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    getFriendRecommendations(controller.signal).then((result) => {
      if (!controller.signal.aborted) { setItems(result); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    return () => controller.abort();
  }, [revision]);
  return <section className="friendship-page recommendations" aria-labelledby="recommendations-title">
    <header className="friendship-heading"><span className="profile-eyebrow">CỘNG ĐỒNG WEYLUME</span><h1 id="recommendations-title">Gợi ý kết bạn</h1><p>Thành viên được gợi ý qua các kết nối chung của bạn.</p></header>
    <nav className="friendship-subnav" aria-label="Kết nối bạn bè"><Link to="/ban-be">Bạn bè</Link><Link to="/ban-be/goi-y" aria-current="page">Gợi ý</Link><Link to="/ban-be/loi-moi?direction=received">Lời mời nhận</Link><Link to="/ban-be/loi-moi?direction=sent">Lời mời đã gửi</Link></nav>
    {invitedName && <p role="status">Đã gửi lời mời đến {invitedName}. <Link to="/ban-be/loi-moi?direction=sent">Xem lời mời đã gửi</Link></p>}
    {loading && <p role="status">Đang tải gợi ý…</p>}
    {error && <Alert tone="error">Chưa thể tải gợi ý kết bạn. <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>Thử lại</Button></Alert>}
    {!loading && !error && items.length === 0 && <p>Hiện chưa có gợi ý phù hợp.</p>}
    {!loading && !error && <ul className="friendship-list" aria-label="Thành viên được gợi ý">{items.map((person) => <li className="friendship-card" key={person.id}>
      <div className="friendship-card__body"><h2><Link to={`/thanh-vien/${encodeURIComponent(person.id)}`}>{person.displayName}</Link></h2>
        {person.bio && <p>{person.bio}</p>}{person.location && <p className="friendship-card__meta">{person.location}</p>}
        <p className="friendship-card__meta">{person.mutualFriendCount === 1 ? '1 bạn chung' : `${person.mutualFriendCount} bạn chung`}</p>
        <FriendshipActions memberId={person.id} onRelationshipChanged={(relationship) => {
          if (relationship?.state === 'outgoing_pending') setInvitedName(person.displayName);
          setRevision((value) => value + 1);
        }} />
      </div></li>)}</ul>}
  </section>;
}
