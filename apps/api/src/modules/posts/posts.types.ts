export interface PostAuthor {
  id: string;
  displayName: string;
}

export interface Post {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: PostAuthor;
  mine: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  likedByMe: boolean;
  sharedByMe: boolean;
}

export interface PostPage {
  items: Post[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: PostAuthor;
  mine: boolean;
}
