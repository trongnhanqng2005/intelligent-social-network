import { useCallback } from 'react';
import { listMemberPosts } from '../api/posts-api';
import { PostList } from './post-list';
import './posts.css';

export function ProfilePosts({ memberId, refreshKey = 0 }: { memberId: string; refreshKey?: number }) {
  const loadPage = useCallback((cursor?: string, signal?: AbortSignal) =>
    listMemberPosts(memberId, { limit: 20, ...(cursor ? { cursor } : {}) }, signal), [memberId]);
  return <PostList loadPage={loadPage} refreshKey={refreshKey} heading="Bài viết" clearOnRefreshKeyChange />;
}
