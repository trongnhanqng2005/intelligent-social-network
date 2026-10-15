import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { createComment, createPost, deleteComment, deletePost, listComments, listFeed, PostsApiError, toggleLike, toggleShare, updatePost, type FeedComment, type FeedPost } from '../api/posts-api';
import './feed.css';

export function FeedPage() {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [comments, setComments] = useState<Record<string, FeedComment[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [commentOpen, setCommentOpen] = useState<Record<string, boolean>>({});
  const [interactionPending, setInteractionPending] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listFeed(cursor, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setItems(page.items);
      setNextCursor(page.pagination.nextCursor);
      setLoading(false);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Không thể tải bảng tin.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [cursor]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      if (editing) {
        const updated = await updatePost(editing, content);
        setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
        setNotice('Bài viết đã được cập nhật.');
      } else {
        const created = await createPost(content);
        setItems((current) => [created, ...current]);
        setNotice('Đã đăng bài viết.');
      }
      setContent('');
      setEditing(undefined);
    } catch (cause) {
      setError(cause instanceof PostsApiError ? cause.message : 'Không thể lưu bài viết.');
    } finally {
      setPending(false);
    }
  }

  async function remove(item: FeedPost) {
    if (pending || !window.confirm('Bạn có chắc muốn xóa bài viết này không?')) return;
    setPending(true);
    setError('');
    try {
      await deletePost(item.id);
      setItems((current) => current.filter((value) => value.id !== item.id));
      setNotice('Đã xóa bài viết.');
    } catch (cause) {
      setError(cause instanceof PostsApiError ? cause.message : 'Không thể xóa bài viết.');
    } finally {
      setPending(false);
    }
  }

  async function react(item: FeedPost, kind: 'like' | 'share') {
      if (interactionPending) return;
      setInteractionPending(`${kind}:${item.id}`);
      try {
        const active = kind === 'like' ? !item.likedByMe : !item.sharedByMe;
        if (kind === 'like') await toggleLike(item.id, active);
        else await toggleShare(item.id, active);
        setItems((current) => current.map((value) => value.id === item.id ? {
          ...value,
          ...(kind === 'like' ? { likedByMe: active, likeCount: value.likeCount + (active ? 1 : -1) } : { sharedByMe: active, shareCount: value.shareCount + (active ? 1 : -1) }),
        } : value));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không thể cập nhật tương tác.');
      } finally {
        setInteractionPending(undefined);
      }
  }

  async function toggleComments(item: FeedPost) {
      if (commentOpen[item.id]) {
        setCommentOpen((current) => ({ ...current, [item.id]: false }));
        return;
      }
      try {
        const values = await listComments(item.id);
        setComments((current) => ({ ...current, [item.id]: values }));
        setCommentOpen((current) => ({ ...current, [item.id]: true }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không thể tải bình luận.');
      }
  }

  async function submitComment(item: FeedPost) {
      const draft = commentDraft[item.id]?.trim();
      if (!draft || interactionPending) return;
      setInteractionPending(`comment:${item.id}`);
      try {
        const comment = await createComment(item.id, draft);
        setComments((current) => ({ ...current, [item.id]: [...(current[item.id] ?? []), comment] }));
        setCommentDraft((current) => ({ ...current, [item.id]: '' }));
        setCommentOpen((current) => ({ ...current, [item.id]: true }));
        setItems((current) => current.map((value) => value.id === item.id ? { ...value, commentCount: value.commentCount + 1 } : value));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Không thể thêm bình luận.');
      } finally {
        setInteractionPending(undefined);
    }
  }

  return (
    <section className="feed-page" aria-labelledby="feed-title">
      <header className="feed-heading">
        <span className="profile-eyebrow">DÒNG THỜI GIAN WEYLUME</span>
        <h1 id="feed-title">Bảng tin</h1>
        <p>Cập nhật mới nhất từ bạn và những người bạn đã kết nối.</p>
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <form className="feed-composer" onSubmit={submit}>
        <label htmlFor="post-content">{editing ? 'Chỉnh sửa bài viết' : 'Bạn đang nghĩ gì?'}</label>
        <textarea id="post-content" value={content} maxLength={2000} onChange={(event) => setContent(event.target.value)} placeholder="Chia sẻ điều có ý nghĩa với bạn…" />
        <div className="feed-composer__actions">
          <span>{content.length}/2000</span>
          {editing && <Button type="button" variant="secondary" onClick={() => { setEditing(undefined); setContent(''); }}>Hủy</Button>}
          <Button type="submit" pending={pending} pendingLabel="Đang lưu…">{editing ? 'Lưu thay đổi' : 'Đăng bài'}</Button>
        </div>
      </form>
      {loading && <p role="status">Đang tải bảng tin…</p>}
      {!loading && !items.length && <div className="feed-empty"><h2>Bảng tin đang trống</h2><p>Hãy đăng bài đầu tiên hoặc khám phá thành viên để kết nối.</p><Link className="ui-button ui-button--secondary" to="/kham-pha">Khám phá thành viên</Link></div>}
      <div className="feed-list">
        {items.map((item) => <article className="feed-card" key={item.id}>
          <header><div><Link to={`/thanh-vien/${encodeURIComponent(item.author.id)}`}>{item.author.displayName}</Link><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>
            {item.mine && <div className="feed-card__actions"><Button variant="ghost" disabled={pending} onClick={() => { setEditing(item.id); setContent(item.content); }}>Sửa</Button><Button variant="ghost" disabled={pending} onClick={() => void remove(item)}>Xóa</Button></div>}
          </header>
          <p>{item.content}</p>
          {item.updatedAt !== item.createdAt && <small>Đã chỉnh sửa</small>}
          <div className="feed-card__interactions">
            <Button variant="ghost" disabled={Boolean(interactionPending)} onClick={() => void react(item, 'like')}>{item.likedByMe ? 'Bỏ thích' : 'Thích'} ({item.likeCount})</Button>
            <Button variant="ghost" onClick={() => void toggleComments(item)}>Bình luận ({item.commentCount})</Button>
            <Button variant="ghost" disabled={Boolean(interactionPending)} onClick={() => void react(item, 'share')}>{item.sharedByMe ? 'Đã chia sẻ' : 'Chia sẻ'} ({item.shareCount})</Button>
          </div>
          {commentOpen[item.id] && <div className="feed-comments">
            {(comments[item.id] ?? []).map((comment) => <div className="feed-comment" key={comment.id}><strong>{comment.author.displayName}</strong><span>{comment.content}</span>{comment.mine && <Button variant="ghost" onClick={() => void deleteComment(item.id, comment.id).then(() => {
              setComments((current) => ({ ...current, [item.id]: (current[item.id] ?? []).filter((value) => value.id !== comment.id) }));
              setItems((current) => current.map((value) => value.id === item.id ? { ...value, commentCount: Math.max(0, value.commentCount - 1) } : value));
            })}>Xóa</Button>}</div>)}
            <div className="feed-comment-form"><input value={commentDraft[item.id] ?? ''} maxLength={1000} onChange={(event) => setCommentDraft((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Viết bình luận…" /><Button pending={interactionPending === `comment:${item.id}`} onClick={() => void submitComment(item)}>Gửi</Button></div>
          </div>}
        </article>)}
      </div>
      {!loading && nextCursor && <Button variant="secondary" onClick={() => setCursor(nextCursor)}>Tải thêm</Button>}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
