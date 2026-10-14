import { useCallback, useEffect, useRef, useState } from 'react';
import { UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  actOnFriendshipRequest,
  createFriendshipRequest,
  FriendshipApiError,
  getFriendshipRelationship,
  unfriend,
  type FriendshipRelationship,
} from '../api/friendships-api';
import './friendships.css';

export function FriendshipActions({ memberId }: { memberId: string }) {
  const { retry: retrySession } = useAuth();
  const [relationship, setRelationship] = useState<FriendshipRelationship>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const actionsRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const restoreFocusToTrigger = useRef(false);

  const reload = useCallback(() => {
    headingRef.current?.focus();
    setLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRelationship(undefined);
    getFriendshipRelationship(memberId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setRelationship(result);
      setError('');
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải trạng thái kết nối.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [memberId, reloadKey, retrySession]);

  useEffect(() => {
    if (confirmUnfriend) {
      confirmationRef.current?.focus();
    } else if (restoreFocusToTrigger.current) {
      restoreFocusToTrigger.current = false;
      actionsRef.current?.querySelector<HTMLButtonElement>('.friendship-action-group > button')?.focus();
    }
  }, [confirmUnfriend]);

  async function perform(action: 'send' | 'accept' | 'reject' | 'cancel' | 'unfriend') {
    if (!relationship || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'send') {
        const result = await createFriendshipRequest(memberId);
        setRelationship(result.relationship);
        setMessage('Đã gửi lời mời kết bạn.');
      } else if (action === 'unfriend') {
        if (!relationship.friendshipId) return;
        await unfriend(relationship.friendshipId);
        setConfirmUnfriend(false);
        setMessage('Đã hủy kết bạn.');
        const current = await getFriendshipRelationship(memberId);
        setRelationship(current);
      } else {
        if (!relationship.requestId) return;
        const result = await actOnFriendshipRequest(relationship.requestId, action);
        setRelationship(result.relationship);
        setConfirmUnfriend(false);
        setMessage(action === 'accept'
          ? 'Hai bạn đã trở thành bạn bè.'
          : action === 'reject' ? 'Đã từ chối lời mời kết bạn.' : 'Đã hủy lời mời kết bạn.');
      }
      headingRef.current?.focus();
    } catch (cause) {
      if (cause instanceof FriendshipApiError && cause.status === 401) retrySession();
      if (!(cause instanceof FriendshipApiError) || cause.status === 409 || cause.status === undefined) {
        try {
          setRelationship(await getFriendshipRelationship(memberId));
        } catch {
          reload();
        }
      }
      setError(cause instanceof Error ? cause.message : 'Thao tác chưa hoàn tất. Hãy kiểm tra lại trạng thái.');
      headingRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return (
    <section ref={actionsRef} className="friendship-actions" aria-label="Kết nối bạn bè">
      <h3 ref={headingRef} tabIndex={-1}>Kết nối</h3>
      <p className="friendship-state-loading" role="status">Đang tải trạng thái kết bạn…</p>
    </section>
  );
  if (error && !relationship) {
    return (
      <section ref={actionsRef} className="friendship-actions" aria-label="Kết nối bạn bè">
        <h3 ref={headingRef} tabIndex={-1}>Kết nối</h3>
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={reload}>Thử tải lại</Button>
      </section>
    );
  }
  if (!relationship || relationship.state === 'self') return null;

  return (
    <section ref={actionsRef} className="friendship-actions" aria-label="Kết nối bạn bè">
      <h3 ref={headingRef} tabIndex={-1}>Kết nối</h3>
      {message && <p className="friendship-feedback friendship-feedback--success" role="status">{message}</p>}
      {error && <Alert tone="error">{error} <Button variant="ghost" onClick={reload}>Tải lại trạng thái</Button></Alert>}
      {relationship.state === 'none' && <Button pending={busy} pendingLabel="Đang gửi lời mời…" onClick={() => void perform('send')}>
        <UserPlus size={17} aria-hidden="true" /> Kết bạn
      </Button>}
      {relationship.state === 'outgoing_pending' && <div className="friendship-action-group">
        <p className="friendship-state-label">Đã gửi lời mời kết bạn</p>
        <Button variant="secondary" pending={busy} pendingLabel="Đang hủy…" onClick={() => void perform('cancel')}>
          Hủy lời mời
        </Button>
      </div>}
      {relationship.state === 'incoming_pending' && <div className="friendship-action-group">
        <p className="friendship-state-label">Thành viên này đã gửi lời mời kết bạn cho bạn.</p>
        <div className="friendship-buttons">
          <Button pending={busy} pendingLabel="Đang chấp nhận…" onClick={() => void perform('accept')}>
            <UserRoundCheck size={17} aria-hidden="true" /> Chấp nhận
          </Button>
          <Button variant="secondary" pending={busy} pendingLabel="Đang từ chối…" onClick={() => void perform('reject')}>
            Từ chối
          </Button>
        </div>
      </div>}
      {relationship.state === 'friends' && <div className="friendship-action-group">
        <p className="friendship-state-label"><UserRoundCheck size={17} aria-hidden="true" /> Hai bạn là bạn bè.</p>
        {!confirmUnfriend ? <Button variant="secondary" onClick={() => setConfirmUnfriend(true)}>
          <UserRoundX size={17} aria-hidden="true" /> Hủy kết bạn
        </Button> : <div ref={confirmationRef} className="friendship-confirmation" role="group" aria-label="Xác nhận hủy kết bạn" tabIndex={-1}>
          <p>Bạn có chắc muốn hủy kết bạn với thành viên này?</p>
          <div className="friendship-buttons">
            <Button pending={busy} pendingLabel="Đang hủy kết bạn…" onClick={() => void perform('unfriend')}>Xác nhận hủy</Button>
            <Button variant="secondary" disabled={busy} onClick={() => {
              restoreFocusToTrigger.current = true;
              setConfirmUnfriend(false);
            }}>Giữ kết bạn</Button>
          </div>
        </div>}
      </div>}
    </section>
  );
}
