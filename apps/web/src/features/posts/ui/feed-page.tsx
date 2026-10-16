import { useCallback, useRef, useState } from 'react';
import { PostComposer } from './post-composer';
import { PostList } from './post-list';
import { listFeed } from '../api/posts-api';
import './posts.css';

export function FeedPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshWaiters = useRef<Array<(success: boolean) => void>>([]);
  const loadPage = useCallback((cursor?: string, signal?: AbortSignal) =>
    listFeed({ limit: 20, ...(cursor ? { cursor } : {}) }, signal), []);
  const refresh = () => {
    const complete = new Promise<boolean>((resolve) => refreshWaiters.current.push(resolve));
    setRefreshKey((current) => current + 1);
    return complete;
  };
  const completeRefresh = useCallback((success: boolean) => {
    for (const resolve of refreshWaiters.current.splice(0)) resolve(success);
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
