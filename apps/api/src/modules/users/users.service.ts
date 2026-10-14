import { HttpStatus, Injectable } from '@nestjs/common';
import { ProfileValidationError, normalizeProfileField, normalizeSearchKey } from '../../domain/user-profile.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { decodeCursor, encodeCursor, normalizeDirectoryQuery, parseDirectoryLimit } from './user-directory.js';
import { ProfileException } from './users.errors.js';
import { UsersRepository } from './users.repository.js';
import type { OwnProfile, ProfileUpdate, PublicProfile } from './users.types.js';

@Injectable()
export class UsersService {
  private readonly limiter = new AuthRateLimiter();

  constructor(private readonly repository: UsersRepository) {}

  async getOwnProfile(userId: string): Promise<{ profile: OwnProfile }> {
    this.consumeRead(userId);
    const profile = await this.repository.findOwnProfile(userId);
    if (!profile) throw notFound();
    return { profile };
  }

  async getMemberProfile(userId: string, memberId: string): Promise<{ profile: PublicProfile }> {
    this.consumeRead(userId);
    const profile = await this.repository.findPublicProfile(memberId);
    if (!profile) throw notFound();
    return { profile };
  }

  async listMembers(userId: string, input: { q?: unknown; limit?: unknown; cursor?: unknown }) {
    this.consumeRead(userId);
    let query: string;
    let limit: number;
    let afterId: string | undefined;
    try {
      query = normalizeDirectoryQuery(input.q);
      limit = parseDirectoryLimit(input.limit);
      afterId = decodeCursor(input.cursor, query);
    } catch (error) {
      throw validationException(error);
    }

    const results = await this.repository.listPublicProfiles({
      userId,
      query,
      ...(afterId ? { afterId } : {}),
      fetchLimit: limit + 1,
    });
    const hasMore = results.length > limit;
    const items = results.slice(0, limit);
    return {
      items,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && items.length ? encodeCursor(query, items.at(-1)!.id) : null,
      },
    };
  }

  async updateOwnProfile(userId: string, input: unknown): Promise<{ profile: OwnProfile }> {
    this.consumeUpdate(userId);
    const patch = this.validateUpdate(userId, input);
    const result = await this.repository.updateProfile(patch);
    if (result.status === 'not-found') throw notFound();
    if (result.status === 'conflict') {
      throw new ProfileException(HttpStatus.CONFLICT, 'PROFILE_CONFLICT', 'Hồ sơ đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu tiếp.');
    }
    return { profile: result.profile };
  }

  private validateUpdate(userId: string, input: unknown): ProfileUpdate {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw validationException(new ProfileValidationError('expectedVersion', 'Dữ liệu cập nhật không hợp lệ.'));
    }
    const value = input as Record<string, unknown>;
    const allowed = new Set(['displayName', 'bio', 'location', 'expectedVersion']);
    const unexpected = Object.keys(value).find((key) => !allowed.has(key));
    if (unexpected) {
      throw validationException(new ProfileValidationError('expectedVersion', 'Dữ liệu cập nhật chứa trường không được phép.'));
    }
    if (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) {
      throw validationException(new ProfileValidationError('expectedVersion', 'Phiên bản hồ sơ không hợp lệ.'));
    }

    const patch: ProfileUpdate = {
      userId,
      expectedVersion: value.expectedVersion as number,
      updatedAt: new Date().toISOString(),
    };
    if (value.displayName !== undefined) {
      try {
        const displayName = normalizeProfileField('displayName', value.displayName)!;
        patch.displayName = displayName;
        patch.displayNameSearch = normalizeSearchKey(displayName);
      } catch (error) {
        throw validationException(error);
      }
    }
    for (const field of ['bio', 'location'] as const) {
      if (value[field] === undefined) continue;
      try {
        patch[field] = normalizeProfileField(field, value[field]);
      } catch (error) {
        throw validationException(error);
      }
    }
    if (patch.displayName === undefined && patch.bio === undefined && patch.location === undefined) {
      throw validationException(new ProfileValidationError('expectedVersion', 'Chọn ít nhất một trường để cập nhật.'));
    }
    return patch;
  }

  private consumeRead(userId: string): void {
    this.consume(userId, 'profile-read', 120);
  }

  private consumeUpdate(userId: string): void {
    this.consume(userId, 'profile-write', 20);
  }

  private consume(userId: string, scope: string, limit: number): void {
    const retryAfterSeconds = this.limiter.consume(AuthRateLimiter.identityKey(scope, userId), limit, 60_000);
    if (retryAfterSeconds > 0) {
      throw new ProfileException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.',
        undefined,
        retryAfterSeconds,
      );
    }
  }
}

function validationException(error: unknown): ProfileException {
  if (error instanceof ProfileException) return error;
  if (error instanceof ProfileValidationError) {
    return new ProfileException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_ERROR',
      'Dữ liệu không hợp lệ.',
      { [error.field]: [error.message] },
    );
  }
  return new ProfileException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.');
}

function notFound(): ProfileException {
  return new ProfileException(HttpStatus.NOT_FOUND, 'PROFILE_NOT_FOUND', 'Không tìm thấy hồ sơ thành viên.');
}
