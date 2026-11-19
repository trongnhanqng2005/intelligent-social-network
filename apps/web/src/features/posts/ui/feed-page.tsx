import { useCallback, useEffect, useRef, useState } from 'react';
import { PostComposer } from './post-composer';
import { PostList } from './post-list';
import { listFeed } from '../api/posts-api';
import './posts.css';

export function FeedPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshKeyRef = useRef(0);
  const refreshWaiters = useRef(new Map<number, (success: boolean) => void>());
  useEffect(() => () => {
    for (const resolve of refreshWaiters.current.values()) resolve(false);
    refreshWaiters.current.clear();
  }, []);
  const loadPage = useCallback((cursor?: string, signal?: AbortSignal) =>
    listFeed({ limit: 20, ...(cursor ? { cursor } : {}) }, signal), []);
  const refresh = () => {
    const key = ++refreshKeyRef.current;
    for (const [pendingKey, resolve] of refreshWaiters.current) {
      if (pendingKey < key) {
        refreshWaiters.current.delete(pendingKey);
        resolve(false);
      }
    }
    const complete = new Promise<boolean>((resolve) => refreshWaiters.current.set(key, resolve));
    setRefreshKey(key);
    return complete;
  };
  const completeRefresh = useCallback((success: boolean, key: number | string) => {
    if (typeof key !== 'number') return;
    const resolve = refreshWaiters.current.get(key);
    if (!resolve) return;
    refreshWaiters.current.delete(key);
    resolve(success);
  }, []);

  return (
    <section className="posts-page" aria-labelledby="feed-title">
      <header className="posts-page-heading">
        <span className="profile-eyebrow">KẾT NỐI MỖI NGÀY</span>
        <h1 id="feed-title">Bảng tin</h1>
        <p>Bài viết mới từ bạn và những người bạn đang kết nối.</p>
      </header>
      <PostComposer onCreated={() => { void refresh(); }} onRefreshFeed={refresh} />
      <PostList loadPage={loadPage} refreshKey={refreshKey} heading="Mới nhất" focusOnMount onLoadComplete={completeRefresh} />
    </section>
  );
}
