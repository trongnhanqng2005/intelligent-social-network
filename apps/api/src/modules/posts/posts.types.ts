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
  media: PostMedia[];
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

export interface PostMedia {
  id: string;
  postId: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  createdAt: string;
  url: string;
}

export interface UploadedMedia {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface RankedPost {
  post: Post;
  score: number;
  reasons: string[];
}
