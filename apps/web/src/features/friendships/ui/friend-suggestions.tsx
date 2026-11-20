import { useEffect, useState } from 'react';
import { RefreshCw, UserPlus, UserRoundX } from 'lucide-react';
import { Link } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useAuth } from '../../auth/model/auth-context';
import { ProfileAvatar } from '../../profile/ui/profile-avatar';
import {
  actOnFriendshipRequest,
  createFriendshipRequest,
  FriendshipApiError,
  listFriendSuggestions,
  type FriendSuggestionItem,
} from '../api/friendships-api';

export function FriendSuggestions({ returnTo, refreshSignal }: {
  returnTo: string;
  refreshSignal: number;
}) {
  const { retry: retrySession } = useAuth();
  const [items, setItems] = useState<FriendSuggestionItem[]>([]);
  const [sentRequests, setSentRequests] = useState<Record<string, string>>({});
  const [busyMemberId, setBusyMemberId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [manualRefresh, setManualRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listFriendSuggestions(8, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setItems(result);
      setSentRequests({});
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải gợi ý kết bạn.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [refreshSignal, manualRefresh, retrySession]);

  async function sendRequest(item: FriendSuggestionItem) {
    if (busyMemberId) return;
    setBusyMemberId(item.member.id);
    setError('');
    setFeedback('');
    try {
      const result = await createFriendshipRequest(item.member.id);
      setSentRequests((prev) => ({ ...prev, [item.member.id]: result.request.id }));
      setFeedback(`Đã gửi lời mời kết bạn tới ${item.member.displayName}.`);
    } catch (cause) {
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể gửi lời mời kết bạn.');
    } finally {
      setBusyMemberId(undefined);
    }
  }

  async function cancelRequest(item: FriendSuggestionItem, requestId: string) {
    if (busyMemberId) return;
    setBusyMemberId(item.member.id);
    setError('');
    setFeedback('');
    try {
      await actOnFriendshipRequest(requestId, 'cancel');
      setSentRequests((prev) => {
        const next = { ...prev };
        delete next[item.member.id];
        return next;
      });
      setFeedback(`Đã hủy lời mời kết bạn tới ${item.member.displayName}.`);
    } catch (cause) {
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể hủy lời mời kết bạn.');
    } finally {
      setBusyMemberId(undefined);
    }
  }

  return (
    <section className="friendship-suggestions" aria-labelledby="friend-suggestions-title">
      <div className="friendship-suggestions__header">
        <div>
          <h2 id="friend-suggestions-title">Gợi ý kết bạn</h2>
          <p>Đề xuất theo thời gian thực từ mạng lưới bạn chung trên đồ thị.</p>
        </div>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => setManualRefresh((n) => n + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> Làm mới
        </Button>
      </div>
      {feedback && <p className="friendship-feedback friendship-feedback--success" role="status">{feedback}</p>}
      {error && <Alert tone="error">{error} <Button variant="ghost" onClick={() => setManualRefresh((n) => n + 1)}>Thử lại</Button></Alert>}
      {loading && <p role="status" className="friendship-state-loading">Đang tìm gợi ý kết bạn…</p>}
      {!loading && !error && items.length === 0 && (
        <div className="friendship-empty">
          <h3>Chưa có gợi ý kết bạn mới.</h3>
          <p>Bạn có thể tìm thêm thành viên ở trang Khám phá.</p>
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="friendship-list" aria-label="Danh sách gợi ý kết bạn">
          {items.map((item) => {
            const pendingRequestId = sentRequests[item.member.id];
            const isBusy = busyMemberId === item.member.id;
            return (
              <li className="friendship-card" key={item.member.id}>
                <ProfileAvatar name={item.member.displayName} size="small" />
                <div className="friendship-card__body">
                  <h3>
                    <Link to={`/thanh-vien/${encodeURIComponent(item.member.id)}`} state={{ from: returnTo }}>
                      {item.member.displayName}
                    </Link>
                  </h3>
                  {item.member.bio && <p>{item.member.bio}</p>}
                  <p className="friendship-card__meta">
                    {item.reason}
                    {item.score > 0 ? ` · Điểm gợi ý: ${item.score.toFixed(2)}` : ''}
                    {item.member.location ? ` · ${item.member.location}` : ''}
                  </p>
                  {pendingRequestId ? (
                    <div className="friendship-buttons">
                      <span className="friendship-state-label">Đã gửi lời mời</span>
                      <Button
                        type="button"
                        variant="secondary"
                        pending={isBusy}
                        pendingLabel="Đang hủy…"
                        disabled={Boolean(busyMemberId) && !isBusy}
                        onClick={() => void cancelRequest(item, pendingRequestId)}
                      >
                        <UserRoundX size={16} aria-hidden="true" /> Hủy lời mời
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      pending={isBusy}
                      pendingLabel="Đang gửi…"
                      disabled={Boolean(busyMemberId) && !isBusy}
                      onClick={() => void sendRequest(item)}
                    >
                      <UserPlus size={16} aria-hidden="true" /> Kết bạn
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
