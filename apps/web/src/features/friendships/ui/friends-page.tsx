import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, UserRoundX } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FriendshipApiError, listFriendships, unfriend, type FriendshipListItem, type FriendshipPage } from '../api/friendships-api';
import { ProfileAvatar } from '../../profile/ui/profile-avatar';
import { useAuth } from '../../auth/model/auth-context';
import './friendships.css';

export function FriendsPage() {
  const location = useLocation();
  const { retry: retrySession } = useAuth();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const restoreFocusId = useRef<string | undefined>(undefined);
  const [cursor, setCursor] = useState<string>();
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [page, setPage] = useState<FriendshipPage<FriendshipListItem>>();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [confirmId, setConfirmId] = useState<string>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (confirmId) {
      confirmationRef.current?.focus();
    } else if (restoreFocusId.current) {
      const friendshipId = restoreFocusId.current;
      restoreFocusId.current = undefined;
      document.getElementById(`friendship-unfriend-${friendshipId}`)?.focus();
    }
  }, [confirmId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listFriendships({ ...(cursor ? { cursor } : {}) }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPage(result);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải danh sách bạn bè.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [cursor, reloadKey, retrySession]);

  async function confirmUnfriend(item: FriendshipListItem) {
    if (busyId) return;
    setBusyId(item.friendshipId);
    setError('');
    setMessage('');
    try {
      await unfriend(item.friendshipId);
      setConfirmId(undefined);
      setError('');
      setMessage(`Đã hủy kết bạn với ${item.member.displayName}.`);
      setReloadKey((value) => value + 1);
      headingRef.current?.focus();
    } catch (cause) {
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      if (!(cause instanceof FriendshipApiError) || cause.status === 409 || cause.status === undefined) {
        setLoading(true);
        try {
          setPage(await listFriendships({ ...(cursor ? { cursor } : {}) }));
        } catch {
          setReloadKey((value) => value + 1);
        } finally {
          setLoading(false);
        }
      }
      setError(cause instanceof Error ? cause.message : 'Chưa thể hủy kết bạn.');
    } finally {
      setBusyId(undefined);
    }
  }

  function nextPage() {
    if (!page?.pagination.nextCursor) return;
    setError('');
    setPreviousCursors((values) => [...values, cursor ?? '']);
    setCursor(page.pagination.nextCursor);
  }

  function previousPage() {
    if (!previousCursors.length) return;
    setError('');
    setCursor(previousCursors.at(-1) || undefined);
    setPreviousCursors((values) => values.slice(0, -1));
  }

  const returnTo = `${location.pathname}${location.search}`;

  return (
    <section className="friendship-page" aria-labelledby="friends-title">
      <header className="friendship-heading">
        <span className="profile-eyebrow">CỘNG ĐỒNG WEYLUME</span>
        <h1 id="friends-title" ref={headingRef} tabIndex={-1}>Bạn bè</h1>
        <p>Những thành viên bạn đã kết nối.</p>
      </header>
      <nav className="friendship-subnav" aria-label="Kết nối bạn bè">
        <Link aria-current="page" to="/ban-be">Bạn bè</Link>
        <Link to="/ban-be/loi-moi?direction=received">Lời mời nhận</Link>
        <Link to="/ban-be/loi-moi?direction=sent">Lời mời đã gửi</Link>
      </nav>
      {message && <p className="friendship-feedback friendship-feedback--success" role="status">{message}</p>}
      {error && <Alert tone="error">{error} <Button variant="ghost" onClick={() => {
        setError('');
        setLoading(true);
        setReloadKey((value) => value + 1);
      }}>Thử lại</Button></Alert>}
      {loading && <p role="status">Đang tải bạn bè…</p>}
      {!loading && !error && page && page.items.length === 0 && !previousCursors.length && !page.pagination.hasMore && <div className="friendship-empty">
        <h2>Bạn chưa có bạn bè.</h2>
        <p>Khám phá thành viên để bắt đầu kết nối.</p>
        <Link className="ui-button ui-button--primary" to="/kham-pha">Khám phá thành viên</Link>
      </div>}
      {!loading && !error && page && page.items.length === 0 && (previousCursors.length > 0 || page.pagination.hasMore) && <div className="friendship-empty">
        <h2>Trang này hiện không có bạn bè.</h2>
        <p>{previousCursors.length ? 'Bạn có thể quay lại trang trước.' : 'Bạn có thể tiếp tục đến trang sau.'}</p>
      </div>}
      {!loading && !error && page && (page.items.length > 0 || previousCursors.length > 0 || page.pagination.hasMore) && <>
        {page.items.length > 0 && <ul className="friendship-list" aria-label="Danh sách bạn bè">
          {page.items.map((item) => <li className="friendship-card" key={item.friendshipId}>
            <ProfileAvatar name={item.member.displayName} size="small" />
            <div className="friendship-card__body">
              <h2><Link to={`/thanh-vien/${encodeURIComponent(item.member.id)}`} state={{ from: returnTo }}>{item.member.displayName}</Link></h2>
              {item.member.bio && <p>{item.member.bio}</p>}
              <p className="friendship-card__meta">Bạn bè từ {formatDate(item.friendsSince)}</p>
              {!confirmId || confirmId !== item.friendshipId ? <Button id={`friendship-unfriend-${item.friendshipId}`} variant="secondary" disabled={Boolean(busyId)} onClick={() => setConfirmId(item.friendshipId)}>
                <UserRoundX size={17} aria-hidden="true" /> Hủy kết bạn
              </Button> : <div ref={confirmationRef} className="friendship-confirmation" role="group" aria-label={`Xác nhận hủy kết bạn với ${item.member.displayName}`} tabIndex={-1}>
                <p>Bạn muốn hủy kết bạn với {item.member.displayName}?</p>
                <div className="friendship-buttons">
                  <Button pending={busyId === item.friendshipId} pendingLabel="Đang hủy kết bạn…" onClick={() => void confirmUnfriend(item)}>Xác nhận hủy</Button>
                  <Button variant="secondary" disabled={Boolean(busyId)} onClick={() => {
                    restoreFocusId.current = item.friendshipId;
                    setConfirmId(undefined);
                  }}>Giữ kết bạn</Button>
                </div>
              </div>}
            </div>
          </li>)}
        </ul>}
        <nav className="directory-pagination" aria-label="Phân trang bạn bè">
          <Button type="button" variant="secondary" disabled={!previousCursors.length} onClick={previousPage}>
            <ArrowLeft size={17} aria-hidden="true" /> Trang trước
          </Button>
          <span className="visually-hidden" role="status">{page.pagination.hasMore ? 'Còn bạn bè ở trang tiếp theo.' : 'Đã đến cuối danh sách.'}</span>
          <Button type="button" variant="secondary" disabled={!page.pagination.hasMore} onClick={nextPage}>
            Trang tiếp <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </nav>
      </>}
    </section>
  );
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'gần đây';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(timestamp);
}
