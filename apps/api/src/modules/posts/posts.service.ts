import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { decodeCursor, encodeCursor, parseLimit } from './posts-pagination.js';
import { PostException } from './posts.errors.js';
import { PostsRepository } from './posts.repository.js';
import { MediaStorageService } from './media-storage.service.js';
import type { Post, PostMedia, RankedPost, UploadedMedia } from './posts.types.js';

@Injectable()
export class PostsService {
  private readonly limiter = new AuthRateLimiter();
  constructor(private readonly repository: PostsRepository, private readonly mediaStorage: MediaStorageService) {}

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

  async ranking(userId: string, input: { limit?: unknown }): Promise<{ items: RankedPost[] }> {
    this.consume(userId, 'post-read', 120);
    const limit = parseLimit(input.limit);
    const posts = await this.repository.listFeed({ userId, fetchLimit: 50 });
    const now = Date.now();
    const ranked = posts.map((post) => rankPost(post, now))
      .sort((a, b) => b.score - a.score || b.post.createdAt.localeCompare(a.post.createdAt) || b.post.id.localeCompare(a.post.id))
      .slice(0, limit);
    return { items: ranked };
  }

  async uploadMedia(userId: string, postId: string, file: UploadedMedia | undefined): Promise<{ media: PostMedia }> {
    this.consume(userId, 'post-write', 20);
    validateMedia(file);
    const id = randomUUID();
    const extension = this.mediaStorage.extensionFor(file.originalname, file.mimetype);
    await this.mediaStorage.save(id, extension, file.buffer);
    try {
      const media = await this.repository.createMedia({
        id, postId, userId, mediaType: file.mimetype.startsWith('video/') ? 'video' : 'image',
        mimeType: file.mimetype, sizeBytes: file.size, originalName: safeOriginalName(file.originalname),
        storageExtension: extension, now: new Date().toISOString(),
      });
      if (media === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Không tìm thấy bài viết.');
      if (media === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể thêm media vào bài viết này.');
      return { media };
    } catch (error) {
      await this.mediaStorage.remove(id, extension).catch(() => undefined);
      throw error;
    }
  }

  async readMedia(userId: string, mediaId: string): Promise<{ media: PostMedia; data: Buffer; extension: string }> {
    const result = await this.repository.getMedia(mediaId, userId);
    if (result === 'not-found') throw new PostException(HttpStatus.NOT_FOUND, 'MEDIA_NOT_FOUND', 'Không tìm thấy media.');
    if (result === 'forbidden') throw new PostException(HttpStatus.FORBIDDEN, 'POST_FORBIDDEN', 'Bạn không thể xem media này.');
    const extension = this.mediaStorage.extensionFor(result.originalName, result.mimeType);
    const data = await this.mediaStorage.read(result.id, extension);
    return { media: result, data, extension };
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

const maxMediaBytes = 10 * 1024 * 1024;
const mediaTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']);

function validateMedia(file: UploadedMedia | undefined): asserts file is UploadedMedia {
  if (!file || !Buffer.isBuffer(file.buffer) || file.size < 1 || file.size > maxMediaBytes || !mediaTypes.has(file.mimetype)) {
    throw new PostException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_INVALID', 'Media không hợp lệ. Chỉ hỗ trợ ảnh/video tối đa 10 MB.');
  }
  const signature = file.buffer.subarray(0, 12);
  const valid = file.mimetype === 'image/jpeg' && signature[0] === 0xff && signature[1] === 0xd8 ||
    file.mimetype === 'image/png' && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    file.mimetype === 'image/gif' && Buffer.from(signature.subarray(0, 6)).toString() === 'GIF87a' ||
    file.mimetype === 'image/webp' && Buffer.from(signature.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(signature.subarray(8, 12)).toString() === 'WEBP' ||
    file.mimetype === 'video/mp4' && Buffer.from(signature.subarray(4, 8)).toString() === 'ftyp' ||
    file.mimetype === 'video/webm' && Buffer.from(signature.subarray(0, 4)).toString() === '\u001aE\u001df\u001a';
  if (!valid) throw new PostException(HttpStatus.UNPROCESSABLE_ENTITY, 'MEDIA_INVALID', 'Nội dung file không khớp với loại media.');
}

function safeOriginalName(value: string): string {
  return value.replace(/[^\w.\- ]/gu, '_').slice(0, 160) || 'upload';
}

function rankPost(post: Post, now: number): RankedPost {
  const ageHours = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
  const engagement = post.likeCount * 3 + post.commentCount * 4 + post.shareCount * 5;
  const freshness = Math.max(0, 24 - ageHours) / 24;
  const score = Number((engagement + freshness * 10).toFixed(4));
  const reasons = engagement > 0 ? ['Đang có nhiều tương tác'] : ['Bài viết mới'];
  if (freshness >= 0.5) reasons.push('Được đăng gần đây');
  return { post, score, reasons };
}
