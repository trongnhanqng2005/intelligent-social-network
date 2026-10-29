import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { getPost, PostsApiError, type PostView } from '../api/posts-api';
import { PostCard } from './post-card';
import './posts.css';

export function PostDetailPage() {
  const { state } = useAuth();
  const viewerId = state.status === 'authenticated' ? state.session.user.id : '';
  return <PostDetailForViewer key={viewerId} />;
}

function PostDetailForViewer() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const { retry: retrySession } = useAuth();
  const currentPostId = useRef(postId);
  currentPostId.current = postId;
  const [post, setPost] = useState<PostView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PostsApiError>();
  const postRef = useRef<PostView | undefined>(undefined);
  const readRequestId = useRef(0);
  const readController = useRef<AbortController | undefined>(undefined);

  const readPost = useCallback((source: 'initial' | 'retry' | 'focus') => {
    const requestId = ++readRequestId.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const hadPost = Boolean(postRef.current);
    if (source !== 'focus') {
      postRef.current = undefined;
      setPost(undefined);
      setLoading(true);
      setError(undefined);
    }

    getPost(postId, controller.signal).then((value) => {
      if (controller.signal.aborted || requestId !== readRequestId.current || currentPostId.current !== postId) return;
      postRef.current = value;
      setPost(value);
      setLoading(false);
      setError(undefined);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || requestId !== readRequestId.current || currentPostId.current !== postId) return;
      const readError = cause instanceof PostsApiError ? cause : new PostsApiError('Không thể tải bài viết. Vui lòng thử lại.');
      if (readError.status === 401 || readError.status === 404) {
        postRef.current = undefined;
        setPost(undefined);
        setError(readError);
        if (readError.status === 401) retrySession();
      } else if (source !== 'focus' || !hadPost) {
        setError(readError);
      }
      setLoading(false);
    });
    return controller;
  }, [postId, retrySession]);

  useEffect(() => {
    readPost('initial');
    return () => {
      readRequestId.current += 1;
      readController.current?.abort();
      readController.current = undefined;
    };
  }, [readPost]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      readPost('focus');
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [readPost]);

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
        {error.status !== 404 && <Button variant="secondary" onClick={() => readPost('retry')}>
          <RefreshCw size={16} aria-hidden="true" /> Thử tải lại
        </Button>}
      </div>}
      {!loading && !error && post && <PostCard post={post}
        onUpdated={(updated) => {
          if (currentPostId.current === updated.id) {
            readRequestId.current += 1;
            readController.current?.abort();
            postRef.current = updated;
            setPost(updated);
          }
        }}
        onDeleted={(deletedId) => {
          if (currentPostId.current === deletedId) {
            readRequestId.current += 1;
            readController.current?.abort();
            postRef.current = undefined;
            navigate('/bang-tin', { replace: true });
          }
        }} />}
    </section>
  );
}
