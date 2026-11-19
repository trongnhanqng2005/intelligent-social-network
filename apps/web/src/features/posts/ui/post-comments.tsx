import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { createComment, deleteComment, getPost, listComments, PostsApiError, updateComment, type PostComment, type PostView } from '../api/posts-api';
import { countPostContentCodePoints } from '../model/post-content';

const COMMENT_LIMIT = 2000;

export function PostComments({ postId, onPostRefreshed, onUnavailable }: { postId: string; onPostRefreshed(post: PostView): void; onUnavailable(): void }) {
  const { retry: retrySession } = useAuth();
  const [items, setItems] = useState<PostComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const pendingCreate = useRef<{ clientId: string; content: string } | undefined>(undefined);
  const lifecycle = useRef(0);
  const readGeneration = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const cursorRef = useRef<string | null>(null);
  const livePostId = useRef(postId);
  livePostId.current = postId;
  const callbacks = useRef({ onPostRefreshed, onUnavailable, retrySession });
  callbacks.current = { onPostRefreshed, onUnavailable, retrySession };

  function unavailable(status: number) {
    setItems([]); setContent(''); setDraft(''); cursorRef.current = null; setHasMore(false);
    callbacks.current.onUnavailable();
    if (status === 401) callbacks.current.retrySession();
  }

  const load = useCallback(async (next = false) => {
    const ownGeneration = ++readGeneration.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError('');
    try {
      const page = await listComments(postId, { limit: 20, ...(next && cursorRef.current ? { cursor: cursorRef.current } : {}) }, abort.signal);
      if (abort.signal.aborted || ownGeneration !== readGeneration.current || livePostId.current !== postId) return;
      setItems((old) => next ? [...old, ...page.items] : page.items);
      cursorRef.current = page.pagination.nextCursor;
      setHasMore(page.pagination.hasMore);
    } catch (cause) {
      if (abort.signal.aborted || ownGeneration !== readGeneration.current || livePostId.current !== postId) return;
       if (cause instanceof PostsApiError && (cause.status === 401 || cause.status === 404)) unavailable(cause.status);
      else setError(cause instanceof Error ? cause.message : 'Không thể tải bình luận.');
    } finally {
      if (ownGeneration === readGeneration.current) setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    lifecycle.current += 1;
    pendingCreate.current = undefined;
    pendingRef.current = false;
    setPending(false);
    cursorRef.current = null;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { lifecycle.current += 1; readGeneration.current += 1; controller.current?.abort(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, postId]);

  async function reconcile() {
    const ownLifecycle = lifecycle.current;
    try {
      const post = await getPost(postId);
      if (ownLifecycle === lifecycle.current && livePostId.current === postId && post.id === postId) callbacks.current.onPostRefreshed(post);
    } catch (cause) {
      if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return;
      if (cause instanceof PostsApiError && (cause.status === 401 || cause.status === 404)) unavailable(cause.status);
      else setError(cause instanceof Error ? cause.message : 'Không thể tải bài viết.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const rawDraft = content;
    const normalized = rawDraft.trim();
    const length = countPostContentCodePoints(normalized);
    if (!length || length > COMMENT_LIMIT) { setError(length ? 'Bình luận không được vượt quá 2.000 ký tự.' : 'Vui lòng nhập nội dung bình luận.'); return; }
    if (pendingRef.current) return;
    if (!pendingCreate.current || pendingCreate.current.content !== normalized) pendingCreate.current = { clientId: crypto.randomUUID(), content: normalized };
    const request = pendingCreate.current;
    const ownLifecycle = lifecycle.current;
    pendingRef.current = true; setPending(true); setError('');
    try {
      await createComment(postId, request.clientId, request.content);
      if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return;
      pendingCreate.current = undefined;
       setContent((current) => current === rawDraft ? '' : current);
      await load();
      await reconcile();
    } catch (cause) {
      if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return;
      if (cause instanceof PostsApiError && (cause.status === 401 || cause.status === 404)) { unavailable(cause.status); return; }
      if (!(cause instanceof PostsApiError && cause.code === 'WRITE_OUTCOME_UNKNOWN')) pendingCreate.current = undefined;
      setError(cause instanceof Error ? cause.message : 'Không thể đăng bình luận.');
    } finally { if (ownLifecycle === lifecycle.current) { pendingRef.current = false; setPending(false); } }
  }

  async function save(comment: PostComment) {
    const normalized = draft.trim();
    const length = countPostContentCodePoints(normalized);
    if (!length || length > COMMENT_LIMIT) { setError(length ? 'Bình luận không được vượt quá 2.000 ký tự.' : 'Vui lòng nhập nội dung bình luận.'); return; }
    if (pendingRef.current) return;
    const ownLifecycle = lifecycle.current;
    pendingRef.current = true; setPending(true); setError('');
    try { await updateComment(postId, comment.id, normalized, comment.version); if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return; setEditing(null); await load(); await reconcile(); }
     catch (cause) { if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return; if (cause instanceof PostsApiError && (cause.status === 401 || cause.status === 404)) { unavailable(cause.status); return; } setError(cause instanceof Error ? cause.message : 'Không thể cập nhật bình luận.'); }
     finally { if (ownLifecycle === lifecycle.current) { pendingRef.current = false; setPending(false); } }
  }

  async function remove(comment: PostComment) {
    if (pendingRef.current) return;
    const ownLifecycle = lifecycle.current;
    pendingRef.current = true; setPending(true); setError('');
    try { await deleteComment(postId, comment.id, comment.version); if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return; await load(); await reconcile(); }
    catch (cause) { if (ownLifecycle !== lifecycle.current || livePostId.current !== postId) return; if (cause instanceof PostsApiError && (cause.status === 401 || cause.status === 404)) { unavailable(cause.status); return; } setError(cause instanceof Error ? cause.message : 'Không thể xóa bình luận.'); }
    finally { if (ownLifecycle === lifecycle.current) { pendingRef.current = false; setPending(false); } }
  }

  return <section className="post-comments" aria-labelledby={`comments-title-${postId}`}>
    <h2 id={`comments-title-${postId}`}>Bình luận</h2>
    <form onSubmit={submit} noValidate>
      <label htmlFor={`comment-content-${postId}`}>Viết bình luận</label>
      <textarea id={`comment-content-${postId}`} value={content} maxLength={8000} disabled={pending} onChange={(event) => setContent(event.currentTarget.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" pending={pending} pendingLabel="Đang đăng…">Đăng bình luận</Button>
    </form>
    {loading && <p role="status">Đang tải bình luận…</p>}
    {!loading && items.length === 0 && <p>Chưa có bình luận.</p>}
    <ul className="post-comments-list">{items.map((comment) => <li key={comment.id}>
      <strong>{comment.author.displayName}</strong>
      {editing === comment.id ? <><textarea aria-label="Chỉnh sửa bình luận" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
        <Button disabled={pending} onClick={() => void save(comment)}>Lưu bình luận</Button><Button variant="secondary" onClick={() => setEditing(null)}>Hủy</Button></> : <p>{comment.content}</p>}
      {comment.permissions.canEdit && editing !== comment.id && <Button variant="ghost" onClick={() => { setDraft(comment.content); setEditing(comment.id); }}>Sửa</Button>}
      {comment.permissions.canDelete && <Button variant="ghost" disabled={pending} onClick={() => void remove(comment)}>Xóa</Button>}
    </li>)}</ul>
    {hasMore && <Button variant="secondary" disabled={loading} onClick={() => void load(true)}>Tải thêm bình luận</Button>}
  </section>;
}
