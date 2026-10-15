import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { decodeCursor, encodeCursor, parseLimit } from './posts-pagination.js';
import { PostException } from './posts.errors.js';
import { PostsRepository } from './posts.repository.js';

@Injectable()
export class PostsService {
  private readonly limiter = new AuthRateLimiter();
  constructor(private readonly repository: PostsRepository) {}

  async create(authorId: string, content: unknown) {
    this.consume(authorId, 'post-write', 20);
    const normalized = validateContent(content);
    const post = await this.repository.create({ id: randomUUID(), authorId, content: normalized, now: new Date().toISOString() });
    if (!post) throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy tác giả.');
    return { post };
  }

  async update(authorId: string, id: string, content: unknown) {
    this.consume(authorId, 'post-write', 20);
    const outcome = await this.repository.update({ id, authorId, content: validateContent(content), now: new Date().toISOString() });
    if (outcome === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
    if (outcome === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể chỉnh sửa bài viết này.');
    return { post: outcome };
  }

  async remove(authorId: string, id: string): Promise<void> {
    this.consume(authorId, 'post-write', 20);
    const outcome = await this.repository.remove(id, authorId);
    if (outcome === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
    if (outcome === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể xóa bài viết này.');
  }

  async feed(userId: string, input: { limit?: unknown; cursor?: unknown }) {
    this.consume(userId, 'post-read', 120);
    const limit = parseLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const results = await this.repository.listFeed({ userId, ...(cursor ? { cursor } : {}), fetchLimit: limit + 1 });
    const items = results.slice(0, limit);
    const hasMore = results.length > limit;
    return {
      items,
      pagination: { limit, hasMore, nextCursor: hasMore && items.length ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null },
    };
  }

  async toggleLike(userId: string, postId: string, liked: boolean) {
    this.consume(userId, 'post-write', 20);
    const outcome = await this.repository.toggleLike(postId, userId, randomUUID(), new Date().toISOString(), liked);
    return this.resolveVisibility(outcome, 'Bạn không thể thích bài viết này.');
  }

  async toggleShare(userId: string, postId: string, shared: boolean) {
    this.consume(userId, 'post-write', 20);
    const outcome = await this.repository.toggleShare(postId, userId, randomUUID(), new Date().toISOString(), shared);
    return this.resolveVisibility(outcome, 'Bạn không thể chia sẻ bài viết này.');
  }

  async listComments(userId: string, postId: string) {
    this.consume(userId, 'post-read', 120);
    const result = await this.repository.listComments(postId, userId);
    if (result === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
    if (result === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể xem bình luận này.');
    return { items: result };
  }

  async createComment(userId: string, postId: string, content: unknown) {
    this.consume(userId, 'post-write', 20);
    const result = await this.repository.createComment({
      id: randomUUID(), postId, userId, content: validateComment(content), now: new Date().toISOString(),
    });
    if (result === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
    if (result === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể bình luận bài viết này.');
    return { comment: result };
  }

  async removeComment(userId: string, commentId: string) {
    this.consume(userId, 'post-write', 20);
    const result = await this.repository.removeComment(commentId, userId);
    if (result === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'COMMENT_NOT_FOUND', 'Không tìm thấy bình luận.');
    if (result === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'COMMENT_FORBIDDEN', 'Bạn không thể xóa bình luận này.');
  }

  private resolveVisibility(outcome: boolean | 'not-found' | 'forbidden', forbiddenMessage: string) {
    if (outcome === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
    if (outcome === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', forbiddenMessage);
    return { active: outcome };
  }

  private consume(userId: string, scope: string, limit: number): void {
    const retryAfterSeconds = this.limiter.consume(AuthRateLimiter.identityKey(scope, userId), limit, 60_000);
    if (retryAfterSeconds > 0) throw new PostException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.', undefined, retryAfterSeconds);
  }
}

function validateContent(value: unknown): string {
  if (typeof value !== 'string') throw validation();
  const content = value.trim();
  if (!content || [...content].length > 2000) throw validation();
  return content;
}

function validation(): PostException {
  return new PostException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Nội dung bài viết không hợp lệ.', { content: ['Bài viết phải có từ 1 đến 2.000 ký tự.'] });
}

function validateComment(value: unknown): string {
  if (typeof value !== 'string') throw commentValidation();
  const content = value.trim();
  if (!content || [...content].length > 1000) throw commentValidation();
  return content;
}

function commentValidation(): PostException {
  return new PostException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Nội dung bình luận không hợp lệ.', { content: ['Bình luận phải có từ 1 đến 1.000 ký tự.'] });
}
