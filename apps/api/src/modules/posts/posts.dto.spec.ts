import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePostDto,
  DeletePostQueryDto,
  MemberPostsParamsDto,
  PostIdParamsDto,
  PostsListQueryDto,
  UpdatePostDto,
} from './posts.dto.js';

const postId = '33333333-3333-4333-8333-333333333333';
const memberId = '22222222-2222-4222-8222-222222222222';

describe('Posts DTO validation', () => {
  const validateDto = (type: new () => object, value: object) =>
    validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });

  it('accepts plain-text create input and only the approved visibility values', async () => {
    await expect(validateDto(CreatePostDto, { content: 'Xin chào', visibility: 'friends' })).resolves.toHaveLength(0);
    await expect(validateDto(CreatePostDto, { content: 'Xin chào', visibility: 'members' })).resolves.toHaveLength(0);
    await expect(validateDto(CreatePostDto, { content: 'Xin chào', visibility: 'public' })).resolves.not.toHaveLength(0);
    await expect(validateDto(CreatePostDto, { content: 'Xin chào', extra: true })).resolves.not.toHaveLength(0);
  });

  it('requires a string body and a nonnegative safe expected version', async () => {
    await expect(validateDto(UpdatePostDto, { content: 'Sửa', expectedVersion: 0 })).resolves.toHaveLength(0);
    for (const expectedVersion of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0']) {
      await expect(validateDto(UpdatePostDto, { content: 'Sửa', expectedVersion })).resolves.not.toHaveLength(0);
    }
    await expect(validateDto(UpdatePostDto, { content: 42, expectedVersion: 0 })).resolves.not.toHaveLength(0);
  });

  it('canonicalizes UUID path parameters and rejects malformed identifiers', async () => {
    await expect(validateDto(PostIdParamsDto, { postId: postId.toUpperCase() })).resolves.toHaveLength(0);
    await expect(validateDto(PostIdParamsDto, { postId: 'not-a-uuid' })).resolves.not.toHaveLength(0);
    await expect(validateDto(MemberPostsParamsDto, { memberId })).resolves.toHaveLength(0);
    await expect(validateDto(MemberPostsParamsDto, { memberId: 'invalid' })).resolves.not.toHaveLength(0);
  });

  it('transforms bounded list limits and rejects array or malformed cursor values', async () => {
    const valid = plainToInstance(PostsListQueryDto, { limit: '50', cursor: 'opaque' });
    expect(valid.limit).toBe(50);
    await expect(validate(valid, { whitelist: true, forbidNonWhitelisted: true })).resolves.toHaveLength(0);
    await expect(validateDto(PostsListQueryDto, { limit: '51' })).resolves.not.toHaveLength(0);
    await expect(validateDto(PostsListQueryDto, { limit: ['1', '2'] })).resolves.not.toHaveLength(0);
    await expect(validateDto(PostsListQueryDto, { cursor: ['a', 'b'] })).resolves.not.toHaveLength(0);
  });

  it('transforms a nonnegative delete version and rejects malformed values', async () => {
    const valid = plainToInstance(DeletePostQueryDto, { expectedVersion: '0' });
    expect(valid.expectedVersion).toBe(0);
    await expect(validate(valid, { whitelist: true, forbidNonWhitelisted: true })).resolves.toHaveLength(0);
    await expect(validateDto(DeletePostQueryDto, { expectedVersion: '-1' })).resolves.not.toHaveLength(0);
    await expect(validateDto(DeletePostQueryDto, { expectedVersion: ['0', '1'] })).resolves.not.toHaveLength(0);
  });
});
