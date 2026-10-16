import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/model/auth-context';
import { ProfileAvatar } from '../../profile/ui/profile-avatar';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { deletePost, getPost, PostsApiError, updatePost, type PostView } from '../api/posts-api';
import { countPostContentCodePoints } from '../model/post-content';

export function PostCard({ post, onUpdated, onDeleted }: {
  post: PostView;
  onUpdated(post: PostView): void;
  onDeleted(postId: string): void;
}) {
  const { state, retry: retrySession } = useAuth();
  const viewerId = state.status === 'authenticated' ? state.session.user.id : '';
  const ownPost = post.author.id === viewerId && post.permissions.canEdit;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConflict, setDeleteConflict] = useState(false);
  const [deleteUnknown, setDeleteUnknown] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState('');
  const cardRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const restoreDeleteFocus = useRef(false);
  const restoreEditFocus = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(post.content);
  }, [post, editing]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (confirmDelete) confirmationRef.current?.focus();
    else if (restoreDeleteFocus.current) {
      restoreDeleteFocus.current = false;
      cardRef.current?.querySelector<HTMLButtonElement>('[data-post-action="delete"]')?.focus();
    }
  }, [confirmDelete]);

  useEffect(() => {
    if (!editing && restoreEditFocus.current) {
      restoreEditFocus.current = false;
      cardRef.current?.querySelector<HTMLButtonElement>('[data-post-action="edit"]')?.focus();
    }
  }, [editing]);

  function beginEdit() {
    setDraft(post.content);
    setError('');
    setValidationError('');
    setConflict(false);
    setUnknownOutcome(false);
    setNotice('');
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(post.content);
    restoreEditFocus.current = true;
    setEditing(false);
    setError('');
    setValidationError('');
    setConflict(false);
    setUnknownOutcome(false);
    setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setValidationError('');
    setConflict(false);
    setUnknownOutcome(false);
    setNotice('');
    const count = countPostContentCodePoints(draft);
    if (count === 0 || count > 2000) {
      const message = count === 0 ? 'Vui lòng nhập nội dung bài viết.' : 'Nội dung bài viết không được vượt quá 2.000 ký tự.';
      setValidationError(message);
      setError(message);
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePost(post.id, { content: draft, expectedVersion: post.version });
      onUpdated(updated);
      restoreEditFocus.current = true;
      setEditing(false);
      setNotice('Bài viết đã được cập nhật.');
    } catch (cause) {
      if (cause instanceof PostsApiError && cause.status === 401) retrySession();
      if (cause instanceof PostsApiError && cause.status === 404) {
        onDeleted(post.id);
        return;
      }
      setConflict(cause instanceof PostsApiError && cause.code === 'POST_CONFLICT');
      setUnknownOutcome(cause instanceof PostsApiError && cause.code === 'WRITE_OUTCOME_UNKNOWN');
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật bài viết. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatest() {
    setError('');
    try {
      const latest = await getPost(post.id);
      onUpdated(latest);
      setConflict(false);
      setUnknownOutcome(false);
      setNotice('Đã tải phiên bản mới. Bản nháp vẫn được giữ lại; hãy kiểm tra trước khi lưu tiếp.');
    } catch (cause) {
      if (cause instanceof PostsApiError && cause.status === 401) retrySession();
      if (cause instanceof PostsApiError && cause.status === 404) {
        onDeleted(post.id);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Không thể tải phiên bản mới.');
    }
  }

  async function removePost() {
    setDeleteError('');
    setDeleteConflict(false);
    setDeleteUnknown(false);
    setDeleteNotice('');
    setDeleting(true);
    try {
      await deletePost(post.id, post.version);
      onDeleted(post.id);
    } catch (cause) {
      if (cause instanceof PostsApiError && cause.status === 401) retrySession();
      setDeleteConflict(cause instanceof PostsApiError && cause.code === 'POST_CONFLICT');
      setDeleteUnknown(cause instanceof PostsApiError && cause.code === 'WRITE_OUTCOME_UNKNOWN');
      setDeleteError(cause instanceof Error ? cause.message : 'Không thể xóa bài viết.');
    } finally {
      setDeleting(false);
    }
  }

  async function reloadForDelete() {
    setDeleteError('');
    try {
      const latest = await getPost(post.id);
      onUpdated(latest);
      setDeleteConflict(false);
      setDeleteUnknown(false);
      setDeleteNotice('Đã tải phiên bản mới. Hãy xác nhận lại thao tác xóa.');
    } catch (cause) {
      if (cause instanceof PostsApiError && cause.status === 401) retrySession();
      if (cause instanceof PostsApiError && cause.status === 404) {
        onDeleted(post.id);
        return;
      }
      setDeleteError(cause instanceof Error ? cause.message : 'Không thể tải phiên bản mới.');
    }
  }

  const authorHref = post.author.id === viewerId ? '/ho-so' : `/thanh-vien/${encodeURIComponent(post.author.id)}`;
  const visibilityText = post.visibility === 'friends' ? 'Chỉ bạn bè' : 'Thành viên Weylume';

  return (
    <article ref={cardRef} className="post-card" aria-label={`Bài viết của ${post.author.displayName}`}>
      <header className="post-card-header">
        <ProfileAvatar name={post.author.displayName} size="small" />
        <div className="post-card-author">
          <Link to={authorHref}>{post.author.displayName}</Link>
          <div className="post-card-meta">
            <time dateTime={post.createdAt}>{formatPostTime(post.createdAt)}</time>
            <span aria-hidden="true">·</span>
            <span>{post.visibility === 'friends' ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{visibilityText}</span>
            {post.version > 0 && <span className="post-card-edited">Đã chỉnh sửa</span>}
          </div>
        </div>
      </header>

      {editing ? (
        <form className="post-editor" onSubmit={save} noValidate>
          <label htmlFor={`post-editor-${post.id}`}>Chỉnh sửa nội dung bài viết</label>
          <textarea id={`post-editor-${post.id}`} ref={editorRef} value={draft}
            disabled={saving}
            aria-invalid={Boolean(validationError)}
            aria-describedby={`post-editor-count-${post.id}${validationError ? ` post-editor-error-${post.id}` : ''}`}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              if (validationError) {
                setValidationError('');
                setError('');
              }
            }} rows={5} />
          <span id={`post-editor-count-${post.id}`} className="posts-counter">
            {countPostContentCodePoints(draft).toLocaleString('vi-VN')}/2.000 ký tự
          </span>
          {error && <Alert tone="error"><span id={validationError ? `post-editor-error-${post.id}` : undefined}>{error}</span></Alert>}
          {conflict && <Alert tone="info">Bản nháp vẫn được giữ. Tải phiên bản mới trước khi lưu tiếp.</Alert>}
          {notice && <p className="posts-notice" role="status">{notice}</p>}
          <div className="post-card-actions">
            <Button type="submit" disabled={conflict || unknownOutcome} pending={saving} pendingLabel="Đang lưu…">Lưu thay đổi</Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}>Hủy</Button>
            {(conflict || unknownOutcome) && <Button type="button" variant="ghost" pending={saving}
              pendingLabel="Đang tải…" onClick={() => void reloadLatest()}>Tải phiên bản mới</Button>}
          </div>
        </form>
      ) : (
        <>
          <p className="post-card-content">{post.content}</p>
          {error && <Alert tone="error">{error}{unknownOutcome && <Button variant="ghost" onClick={() => void reloadLatest()}>Tải lại bài viết</Button>}</Alert>}
          {notice && <p className="posts-notice" role="status">{notice}</p>}
          <footer className="post-card-footer">
            <Link className="post-detail-link" to={`/bai-viet/${encodeURIComponent(post.id)}`}>Xem bài viết đầy đủ</Link>
            {ownPost && <div className="post-card-actions">
              <Button data-post-action="edit" variant="ghost" onClick={beginEdit}>
                <Pencil size={16} aria-hidden="true" /> Chỉnh sửa bài viết
              </Button>
              <Button data-post-action="delete" variant="ghost" onClick={() => {
                setDeleteError('');
                setConfirmDelete(true);
              }}>
                <Trash2 size={16} aria-hidden="true" /> Xóa bài viết
              </Button>
            </div>}
          </footer>
        </>
      )}

      {confirmDelete && <div ref={confirmationRef} className="post-delete-confirmation" role="group"
        aria-label="Xác nhận xóa bài viết vĩnh viễn" tabIndex={-1}>
        <p>Bài viết sẽ bị xóa vĩnh viễn và không thể khôi phục.</p>
        {deleteError && <Alert tone={deleteConflict ? 'info' : 'error'}>{deleteError}</Alert>}
        {deleteNotice && <p className="posts-notice" role="status">{deleteNotice}</p>}
        <div className="post-card-actions">
          <Button disabled={deleteConflict || deleteUnknown} pending={deleting} pendingLabel="Đang xóa…" onClick={() => void removePost()}>Xóa vĩnh viễn</Button>
          <Button variant="secondary" disabled={deleting} onClick={() => {
            restoreDeleteFocus.current = true;
            setConfirmDelete(false);
          }}>Hủy</Button>
          {(deleteConflict || deleteUnknown) && <Button type="button" variant="ghost" pending={deleting}
            pendingLabel="Đang tải…" onClick={() => void reloadForDelete()}>Tải phiên bản mới</Button>}
        </div>
      </div>}
    </article>
  );
}

function formatPostTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
