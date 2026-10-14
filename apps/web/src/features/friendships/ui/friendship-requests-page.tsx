import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useAuth } from '../../auth/model/auth-context';
import { ProfileAvatar } from '../../profile/ui/profile-avatar';
import {
  actOnFriendshipRequest,
  FriendshipApiError,
  listFriendshipRequests,
  type FriendshipPage,
  type FriendshipRequestListItem,
} from '../api/friendships-api';
import './friendships.css';

export function FriendshipRequestsPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { retry: retrySession } = useAuth();
  const direction = searchParams.get('direction') === 'sent' ? 'sent' : 'received';
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [cursor, setCursor] = useState<string>();
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [page, setPage] = useState<FriendshipPage<FriendshipRequestListItem>>();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const previousDirection = useRef(direction);

  useEffect(() => {
    if (previousDirection.current === direction) return;
    previousDirection.current = direction;
    setCursor(undefined);
    setPreviousCursors([]);
  }, [direction]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPage(undefined);
    listFriendshipRequests({ direction, ...(cursor ? { cursor } : {}) }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPage(result);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải lời mời kết bạn.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [direction, cursor, reloadKey, retrySession]);

  async function act(item: FriendshipRequestListItem, action: 'accept' | 'reject' | 'cancel') {
    if (busyId) return;
    setBusyId(item.request.id);
    setError('');
    setMessage('');
    try {
      await actOnFriendshipRequest(item.request.id, action);
      setError('');
      setMessage(action === 'accept'
        ? `Bạn và ${item.member.displayName} đã trở thành bạn bè.`
        : action === 'reject'
          ? `Đã từ chối lời mời từ ${item.member.displayName}.`
          : `Đã hủy lời mời gửi đến ${item.member.displayName}.`);
      setReloadKey((value) => value + 1);
      headingRef.current?.focus();
    } catch (cause) {
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      if (!(cause instanceof FriendshipApiError) || cause.status === 409 || cause.status === undefined) {
        setLoading(true);
        try {
          setPage(await listFriendshipRequests({ direction, ...(cursor ? { cursor } : {}) }));
        } catch {
          setReloadKey((value) => value + 1);
        } finally {
          setLoading(false);
        }
      }
      setError(cause instanceof Error ? cause.message : 'Thao tác chưa hoàn tất. Hãy tải lại trạng thái.');
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
  const received = direction === 'received';

  return (
    <section className="friendship-page" aria-labelledby="requests-title">
      <header className="friendship-heading">
        <span className="profile-eyebrow">CỘNG ĐỒNG WEYLUME</span>
        <h1 id="requests-title" ref={headingRef} tabIndex={-1}>{received ? 'Lời mời kết bạn' : 'Lời mời đã gửi'}</h1>
        <p>{received ? 'Xem và phản hồi lời mời từ thành viên khác.' : 'Theo dõi những lời mời bạn đã gửi.'}</p>
      </header>
      <nav className="friendship-subnav" aria-label="Kết nối bạn bè">
        <Link to="/ban-be">Bạn bè</Link>
        <Link to="/ban-be/loi-moi?direction=received" aria-current={received ? 'page' : undefined}>Lời mời nhận</Link>
        <Link to="/ban-be/loi-moi?direction=sent" aria-current={!received ? 'page' : undefined}>Lời mời đã gửi</Link>
      </nav>
      {message && <p className="friendship-feedback friendship-feedback--success" role="status">{message}</p>}
      {error && <Alert tone="error">{error} <Button variant="ghost" onClick={() => {
        setError('');
        setLoading(true);
        setReloadKey((value) => value + 1);
      }}>Thử lại</Button></Alert>}
      {loading && <p role="status">Đang tải lời mời…</p>}
      {!loading && !error && page && page.items.length === 0 && !previousCursors.length && !page.pagination.hasMore && <div className="friendship-empty">
        <h2>{received ? 'Bạn chưa có lời mời kết bạn.' : 'Bạn chưa gửi lời mời nào.'}</h2>
        <p>{received ? 'Khi có lời mời mới, bạn sẽ thấy tại đây.' : 'Khám phá thành viên để bắt đầu kết nối.'}</p>
        {!received && <Link className="ui-button ui-button--primary" to="/kham-pha">Khám phá thành viên</Link>}
      </div>}
      {!loading && !error && page && page.items.length === 0 && (previousCursors.length > 0 || page.pagination.hasMore) && <div className="friendship-empty">
        <h2>Trang này hiện không có lời mời.</h2>
        <p>{previousCursors.length ? 'Bạn có thể quay lại trang trước.' : 'Bạn có thể tiếp tục đến trang sau.'}</p>
      </div>}
      {!loading && !error && page && (page.items.length > 0 || previousCursors.length > 0 || page.pagination.hasMore) && <>
        {page.items.length > 0 && <ul className="friendship-list" aria-label={received ? 'Lời mời đã nhận' : 'Lời mời đã gửi'}>
          {page.items.map((item) => <li className="friendship-card" key={item.request.id}>
            <ProfileAvatar name={item.member.displayName} size="small" />
            <div className="friendship-card__body">
              <h2><Link to={`/thanh-vien/${encodeURIComponent(item.member.id)}`} state={{ from: returnTo }}>{item.member.displayName}</Link></h2>
              {item.member.bio && <p>{item.member.bio}</p>}
              <p className="friendship-card__meta">{received ? 'Đã gửi lời mời cho bạn' : 'Bạn đã gửi lời mời'} · {formatDate(item.request.createdAt)}</p>
              <div className="friendship-buttons">
                {received ? <>
                  <Button pending={busyId === item.request.id} pendingLabel="Đang chấp nhận…" disabled={Boolean(busyId)} onClick={() => void act(item, 'accept')}>Chấp nhận</Button>
                  <Button variant="secondary" pending={busyId === item.request.id} pendingLabel="Đang từ chối…" disabled={Boolean(busyId)} onClick={() => void act(item, 'reject')}>Từ chối</Button>
                </> : <Button variant="secondary" pending={busyId === item.request.id} pendingLabel="Đang hủy…" disabled={Boolean(busyId)} onClick={() => void act(item, 'cancel')}>Hủy lời mời</Button>}
              </div>
            </div>
          </li>)}
        </ul>}
        <nav className="directory-pagination" aria-label="Phân trang lời mời">
          <Button type="button" variant="secondary" disabled={!previousCursors.length} onClick={previousPage}>Trang trước</Button>
          <span className="visually-hidden" role="status">{page.pagination.hasMore ? 'Còn lời mời ở trang tiếp theo.' : 'Đã đến cuối danh sách.'}</span>
          <Button type="button" variant="secondary" disabled={!page.pagination.hasMore} onClick={nextPage}>Trang tiếp</Button>
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
