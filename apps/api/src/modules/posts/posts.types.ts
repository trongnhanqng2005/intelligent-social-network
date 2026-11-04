export type PostVisibility = 'members' | 'friends';

export interface PostAuthor {
  id: string;
  displayName: string;
  bio: string | null;
  location: string | null;
}

export interface PostView {
  id: string;
  content: string;
  visibility: PostVisibility;
  createdAt: string;
  updatedAt: string;
  version: number;
  author: PostAuthor;
  permissions: { canEdit: boolean; canDelete: boolean };
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
}

export interface PostComment {
  id: string;
  clientId: string;
  postId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deleted: boolean;
  author: { id: string; displayName: string };
  permissions: { canEdit: boolean; canDelete: boolean };
}

export interface StoredPost {
  id: string;
  authorId: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  content: string;
  visibility: PostVisibility;
  createdAt: string;
  updatedAt: string;
  version: number;
  authorLinks: number;
  authorCount: number;
  likeCount?: number;
  commentCount?: number;
  likedByViewer?: boolean;
  relationshipCount?: number;
}

export interface PostPage<T> {
  items: T[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export type PostMutationOutcome =
  | { kind: 'updated'; post: StoredPost }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict' };
