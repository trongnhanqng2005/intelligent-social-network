import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalizePostContent, PostContentValidationError } from '../../domain/post-content.js';
import { Neo4jWriteOutcomeUnknownError } from '../../neo4j/neo4j.service.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import {
  decodePostsCursor,
  encodePostsCursor,
  parsePostsLimit,
  PostsPaginationError,
} from './post-pagination.js';
import { PostGraphInvariantError, PostsException } from './posts.errors.js';
import { PostsRepository } from './posts.repository.js';
import type { PostPage, PostView, StoredPost } from './posts.types.js';

@Injectable()
export class PostsService {
  private readonly limiter = new AuthRateLimiter();

  constructor(private readonly repository: PostsRepository) {}

  async create(authorId: string, input: { content: unknown; visibility?: unknown }): Promise<{ post: PostView }> {
    this.consumeMutation(authorId);
    const content = this.normalizeContent(input.content);
    const visibility = input.visibility ?? 'friends';
    if (visibility !== 'friends' && visibility !== 'members') {
      throw validationException('visibility', 'Chọn bạn bè hoặc thành viên Weylume.');
    }
    const createdAt = new Date().toISOString();
    const post = await this.withPostsError(() => this.repository.create({
      id: randomUUID(), authorId, content, visibility, createdAt,
    }));
    if (!post) throw memberNotFound();
    return { post: toPostView(post, authorId) };
  }

  async getPost(viewerId: string, postId: string): Promise<{ post: PostView }> {
    this.consumeRead(viewerId);
    const post = await this.withPostsError(() => this.repository.findVisible(viewerId, postId));
    if (!post) throw postNotFound();
    return { post: toPostView(post, viewerId) };
  }

  async update(
    viewerId: string,
    postId: string,
    input: { content: unknown; expectedVersion: number },
  ): Promise<{ post: PostView }> {
    this.consumeMutation(viewerId);
    const content = this.normalizeContent(input.content);
    const outcome = await this.withPostsError(() => this.repository.update({
      viewerId,
      postId,
      content,
      expectedVersion: input.expectedVersion,
      updatedAt: new Date().toISOString(),
    }));
    if (outcome === 'not-found') throw postNotFound();
    if (outcome === 'forbidden') throw postForbidden();
    if (outcome === 'conflict') throw postConflict();
    return { post: toPostView(outcome, viewerId) };
  }

  async delete(viewerId: string, postId: string, expectedVersion: number): Promise<void> {
    this.consumeMutation(viewerId);
    const outcome = await this.withPostsError(() => this.repository.delete({ viewerId, postId, expectedVersion }));
    if (outcome === 'not-found') throw postNotFound();
    if (outcome === 'forbidden') throw postForbidden();
    if (outcome === 'conflict') throw postConflict();
  }

  async listProfile(
    viewerId: string,
    authorId: string,
    input: { limit?: unknown; cursor?: unknown },
  ): Promise<PostPage<PostView>> {
    this.consumeRead(viewerId);
    const limit = this.parseLimit(input.limit);
    const cursor = this.parseCursor(input.cursor, { scope: 'profile-posts', viewerId, authorId });
    const result = await this.withPostsError(() => this.repository.listProfile({
      viewerId,
      authorId,
      ...(cursor ? { cursor } : {}),
      fetchLimit: limit + 1,
    }));
    if (!result.memberExists) throw memberNotFound();
    return makePage(result.posts, limit, (post) => toPostView(post, viewerId), {
      scope: 'profile-posts', viewerId, authorId,
    });
  }

  async listFeed(viewerId: string, input: { limit?: unknown; cursor?: unknown }): Promise<PostPage<PostView>> {
    this.consumeRead(viewerId);
    const limit = this.parseLimit(input.limit);
    const cursor = this.parseCursor(input.cursor, { scope: 'feed', viewerId, authorId: null });
    const results = await this.withPostsError(() => this.repository.listFeed({
      viewerId,
      ...(cursor ? { cursor } : {}),
      perAuthorLimit: limit + 1,
      fetchLimit: limit + 1,
    }));
    const ordered = [...results].sort(comparePostsDescending);
    return makePage(ordered, limit, (post) => toPostView(post, viewerId), {
      scope: 'feed', viewerId, authorId: null,
    });
  }

  private normalizeContent(value: unknown): string {
    try {
      return normalizePostContent(value);
    } catch (error) {
      if (error instanceof PostContentValidationError) throw validationException('content', error.message);
      throw error;
    }
  }

  private parseLimit(value: unknown): number {
    try {
      return parsePostsLimit(value);
    } catch (error) {
      throw validationException('limit', error instanceof Error ? error.message : 'Số bài viết không hợp lệ.');
    }
  }

  private parseCursor(
    value: unknown,
    expected: Parameters<typeof decodePostsCursor>[1],
  ) {
    try {
      return decodePostsCursor(value, expected);
    } catch (error) {
      const message = error instanceof PostsPaginationError ? error.message : 'Trang bài viết không hợp lệ.';
      throw validationException('cursor', message);
    }
  }

  private consumeRead(userId: string): void {
    this.consume(userId, 'posts-read', 120);
  }

  private consumeMutation(userId: string): void {
    this.consume(userId, 'posts-write', 20);
  }

  private consume(userId: string, scope: string, limit: number): void {
    const retryAfterSeconds = this.limiter.consume(AuthRateLimiter.identityKey(scope, userId), limit, 60_000);
    if (retryAfterSeconds > 0) {
      throw new PostsException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.',
        undefined,
        retryAfterSeconds,
      );
    }
  }

  private async withPostsError<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Neo4jWriteOutcomeUnknownError) {
        throw new PostsException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'WRITE_OUTCOME_UNKNOWN',
          'Chưa thể xác nhận kết quả lưu bài viết. Hãy tải lại để kiểm tra trước khi thử gửi lại.',
        );
      }
      if (error instanceof PostGraphInvariantError) {
        throw new PostsException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'POST_DATA_INCONSISTENT',
          'Dữ liệu bài viết hiện chưa thể xác minh. Vui lòng thử lại sau.',
        );
      }
      throw error;
    }
  }
}

function makePage(
  results: StoredPost[],
  limit: number,
  project: (post: StoredPost) => PostView,
  scope: { scope: 'feed'; viewerId: string; authorId: null } |
    { scope: 'profile-posts'; viewerId: string; authorId: string },
): PostPage<PostView> {
  const hasMore = results.length > limit;
  const posts = results.slice(0, limit);
  const last = posts.at(-1);
  const nextCursor = hasMore && last
    ? scope.scope === 'feed'
      ? encodePostsCursor({
          scope: 'feed', viewerId: scope.viewerId, authorId: null,
          lastCreatedAt: last.createdAt, lastId: last.id,
        })
      : encodePostsCursor({
          scope: 'profile-posts', viewerId: scope.viewerId, authorId: scope.authorId,
          lastCreatedAt: last.createdAt, lastId: last.id,
        })
    : null;
  return {
    items: posts.map(project),
    pagination: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}

function toPostView(post: StoredPost, viewerId: string): PostView {
  const canEdit = post.authorId === viewerId;
  return {
    id: post.id,
    content: post.content,
    visibility: post.visibility,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    version: post.version,
    author: {
      id: post.authorId,
      displayName: post.displayName,
      bio: post.bio,
      location: post.location,
    },
    permissions: { canEdit, canDelete: canEdit },
  };
}

function comparePostsDescending(left: StoredPost, right: StoredPost): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function validationException(field: string, message: string): PostsException {
  return new PostsException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
    [field]: [message],
  });
}

function memberNotFound(): PostsException {
  return new PostsException(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');
}

function postNotFound(): PostsException {
  return new PostsException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
}

function postForbidden(): PostsException {
  return new PostsException(HttpStatus.FORBIDDEN, 'POST_ACTION_FORBIDDEN', 'Bạn không thể chỉnh sửa hoặc xóa bài viết này.');
}

function postConflict(): PostsException {
  return new PostsException(HttpStatus.CONFLICT, 'POST_CONFLICT', 'Bài viết đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu tiếp.');
}
