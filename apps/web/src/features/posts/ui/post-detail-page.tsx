import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { getPost, PostsApiError, type PostView } from '../api/posts-api';
import { PostCard } from './post-card';
import './posts.css';

export function PostDetailPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const { retry: retrySession } = useAuth();
  const currentPostId = useRef(postId);
  currentPostId.current = postId;
  const [post, setPost] = useState<PostView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PostsApiError>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPost(undefined);
    setLoading(true);
    setError(undefined);
    getPost(postId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setPost(value);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof PostsApiError && cause.status === 401) retrySession();
      setError(cause instanceof PostsApiError ? cause : new PostsApiError('Không thể tải bài viết. Vui lòng thử lại.'));
      setLoading(false);
    });
    return () => controller.abort();
  }, [postId, attempt, retrySession]);

  return (
    <section className="posts-page post-detail-page" aria-labelledby="post-detail-title">
      <Link className="posts-back-link" to="/bang-tin"><ArrowLeft size={17} aria-hidden="true" /> Quay lại bảng tin</Link>
      <header className="posts-page-heading"><span className="profile-eyebrow">WEYLUME · BÀI VIẾT</span>
        <h1 id="post-detail-title">Bài viết</h1></header>
      {loading && <p role="status">Đang tải bài viết…</p>}
      {!loading && error && <div className="posts-list-error">
        <Alert tone={error.status === 404 ? 'info' : 'error'}>
          {error.status === 404 ? 'Không tìm thấy bài viết hoặc bạn không có quyền xem bài viết này.' : error.message}
        </Alert>
        {error.status !== 404 && <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> Thử tải lại
        </Button>}
      </div>}
      {!loading && !error && post && <PostCard post={post}
        onUpdated={(updated) => { if (currentPostId.current === updated.id) setPost(updated); }}
        onDeleted={(deletedId) => {
          if (currentPostId.current === deletedId) navigate('/bang-tin', { replace: true });
        }} />}
    </section>
  );
}
