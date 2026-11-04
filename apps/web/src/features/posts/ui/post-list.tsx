import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/model/auth-context';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { PostsApiError, type PostView, type PostsPage } from '../api/posts-api';
import { PostCard } from './post-card';

export type PostPageLoader = (cursor?: string, signal?: AbortSignal) => Promise<PostsPage>;

export function PostList({ loadPage, refreshKey, heading = 'Bài viết', focusOnMount = false, clearOnRefreshKeyChange = false, onLoadComplete }: {
  loadPage: PostPageLoader;
  refreshKey: number | string;
  heading?: string;
  focusOnMount?: boolean;
  clearOnRefreshKeyChange?: boolean;
  onLoadComplete?(success: boolean, refreshKey: number | string): void;
}) {
  const { retry: retrySession } = useAuth();
  const [posts, setPosts] = useState<PostView[]>([]);
  const [pagination, setPagination] = useState<PostsPage['pagination']>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const paginationRef = useRef<PostsPage['pagination'] | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);
  const previousScope = useRef({ loadPage, refreshKey });
  const scopeChanged = previousScope.current.loadPage !== loadPage ||
    (clearOnRefreshKeyChange && previousScope.current.refreshKey !== refreshKey);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    previousScope.current = { loadPage, refreshKey };
    if (scopeChanged) {
      setPosts([]);
      paginationRef.current = undefined;
    }
    setPagination(undefined);
    setLoading(true);
    setLoadError('');
    setMoreError('');
    setMoreLoading(false);
    let completed = false;
    const complete = (success: boolean) => {
      if (completed) return;
      completed = true;
      onLoadComplete?.(success, refreshKey);
    };
    controller.signal.addEventListener('abort', () => complete(false), { once: true });
    if (focusOnMount && !mountedRef.current) headingRef.current?.focus();
    mountedRef.current = true;
    loadPage(undefined, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setPosts(page.items);
      paginationRef.current = page.pagination;
      setPagination(page.pagination);
      setLoading(false);
      complete(true);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof PostsApiError && cause.status === 401) {
        setPosts([]);
        paginationRef.current = undefined;
        setPagination(undefined);
        retrySession();
      }
      setLoadError(cause instanceof Error ? cause.message : 'Không thể tải bài viết. Vui lòng thử lại.');
      setLoading(false);
      complete(false);
    });
    return () => controllerRef.current?.abort();
  }, [loadPage, refreshKey, attempt, focusOnMount, clearOnRefreshKeyChange, retrySession, onLoadComplete]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') setAttempt((value) => value + 1);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  const updatePost = useCallback((updated: PostView) => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    setLoading(false);
    setMoreLoading(false);
    setPagination(paginationRef.current);
    setPosts((current) => current.map((post) => post.id === updated.id ? updated : post));
  }, []);

  const removePost = useCallback((postId: string) => {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    setLoading(false);
    setMoreLoading(false);
    setPagination(paginationRef.current);
    setPosts((current) => current.filter((post) => post.id !== postId));
    headingRef.current?.focus();
  }, []);

  async function loadMore() {
    const cursor = pagination?.nextCursor;
    const controller = controllerRef.current;
    if (!cursor || !controller || controller.signal.aborted || moreLoading) return;
    setMoreLoading(true);
    setMoreError('');
    try {
      const page = await loadPage(cursor, controller.signal);
      if (controller.signal.aborted) return;
      setPosts((current) => {
        const existing = new Set(current.map((post) => post.id));
        const appended: PostView[] = [];
        for (const post of page.items) {
          if (existing.has(post.id)) continue;
          existing.add(post.id);
          appended.push(post);
        }
        return [...current, ...appended];
      });
      paginationRef.current = page.pagination;
      setPagination(page.pagination);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof PostsApiError && cause.status === 401) {
        setPosts([]);
        paginationRef.current = undefined;
        setPagination(undefined);
        retrySession();
      }
      setMoreError(cause instanceof Error ? cause.message : 'Không thể tải thêm bài viết.');
    } finally {
      if (!controller.signal.aborted) setMoreLoading(false);
    }
  }

  return (
    <section className="posts-list-section" aria-labelledby="posts-list-title">
      <div className="posts-list-heading">
        <h2 id="posts-list-title" ref={headingRef} tabIndex={-1}>{heading}</h2>
        <Button type="button" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> Tải mới
        </Button>
      </div>
      {loading && <p className="posts-loading" role="status">Đang tải bài viết…</p>}
      {!loading && loadError && <div className="posts-list-error">
        <Alert tone="error">{loadError}</Alert>
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Thử tải lại</Button>
      </div>}
      {!scopeChanged && !loading && !loadError && posts.length === 0 && <p className="posts-empty">Chưa có bài viết nào để hiển thị.</p>}
      {!scopeChanged && posts.length > 0 && <div className="posts-list" aria-label="Danh sách bài viết">
        {posts.map((post) => <PostCard key={post.id} post={post} onUpdated={updatePost} onDeleted={removePost} />)}
      </div>}
      {!loading && !loadError && pagination?.hasMore && <div className="posts-more">
        {moreError && <Alert tone="error">{moreError}</Alert>}
        <Button type="button" variant="secondary" pending={moreLoading} pendingLabel="Đang tải thêm…"
          onClick={() => void loadMore()}>{moreError ? 'Thử tải thêm' : 'Tải thêm bài viết'}</Button>
      </div>}
    </section>
  );
}
