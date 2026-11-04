import { HttpStatus } from '@nestjs/common';
import { Neo4jWriteOutcomeUnknownError } from '../../neo4j/neo4j.service.js';
import { encodePostsCursor } from './post-pagination.js';
import { PostGraphInvariantError } from './posts.errors.js';
import { PostsService } from './posts.service.js';
import type { StoredPost } from './posts.types.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const friendId = '22222222-2222-4222-8222-222222222222';

function storedPost(overrides: Partial<StoredPost> = {}): StoredPost {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    authorId: viewerId,
    displayName: 'Thành viên Weylume',
    bio: null,
    location: null,
    content: 'Xin chào',
    visibility: 'friends',
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-10-15T10:00:00.000Z',
    version: 0,
    authorLinks: 1,
    authorCount: 1,
    ...overrides,
  };
}

describe('PostsService', () => {
  let repository: {
    create: jest.Mock;
    findVisible: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    listProfile: jest.Mock;
    listFeed: jest.Mock;
  };
  let service: PostsService;

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(storedPost()),
      findVisible: jest.fn().mockResolvedValue(storedPost()),
      update: jest.fn().mockResolvedValue(storedPost({ version: 1, content: 'Đã sửa' })),
      delete: jest.fn().mockResolvedValue('deleted'),
      listProfile: jest.fn().mockResolvedValue({ memberExists: true, posts: [] }),
      listFeed: jest.fn().mockResolvedValue([]),
    };
    service = new PostsService(repository as never);
  });

  it('creates normalized content with a stable request-scoped UUID, timestamp and friends default', async () => {
    const result = await service.create(viewerId, { content: '  Cafe\u0301\r\nXin chào  ' });
    const input = repository.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ authorId: viewerId, content: 'Café\nXin chào', visibility: 'friends' });
    expect(input.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u));
    expect(input.createdAt).toEqual(expect.any(String));
    expect(result.post.permissions).toEqual({ canEdit: true, canDelete: true });
  });

  it('accepts only the two visibility values and does not persist invalid content', async () => {
    await expect(service.create(viewerId, { content: 'hello', visibility: 'public' }))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    await expect(service.create(viewerId, { content: '\u200b' }))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('uses a privacy-preserving 404 for an invisible or missing post', async () => {
    repository.findVisible.mockResolvedValue(undefined);
    await expect(service.getPost(viewerId, storedPost().id)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { error: { code: 'POST_NOT_FOUND' } },
    });
  });

  it('sanitizes inconsistent graph invariants during reads as service unavailable', async () => {
    repository.findVisible.mockRejectedValue(new PostGraphInvariantError());
    await expect(service.getPost(viewerId, storedPost().id)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { error: { code: 'POST_DATA_INCONSISTENT' } },
    });
  });

  it('projects caller permissions as a hint and never changes immutable visibility on edit', async () => {
    repository.findVisible.mockResolvedValue(storedPost({ authorId: friendId, visibility: 'members' }));
    const visible = await service.getPost(viewerId, storedPost().id);
    expect(visible.post.permissions).toEqual({ canEdit: false, canDelete: false });

    repository.update.mockResolvedValue('forbidden');
    await expect(service.update(viewerId, storedPost().id, { content: 'Cập nhật', expectedVersion: 0 }))
      .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'Cập nhật', expectedVersion: 0 }));
  });

  it('maps stale edit and delete versions to consistent conflicts', async () => {
    repository.update.mockResolvedValue('conflict');
    repository.delete.mockResolvedValue('conflict');
    await expect(service.update(viewerId, storedPost().id, { content: 'Mới', expectedVersion: 0 }))
      .rejects.toMatchObject({ status: HttpStatus.CONFLICT, response: { error: { code: 'POST_CONFLICT' } } });
    await expect(service.delete(viewerId, storedPost().id, 0))
      .rejects.toMatchObject({ status: HttpStatus.CONFLICT, response: { error: { code: 'POST_CONFLICT' } } });
  });

  it('maps visible non-owner mutation to 403 while invisible posts stay 404', async () => {
    repository.update.mockResolvedValue('forbidden');
    await expect(service.update(viewerId, storedPost().id, { content: 'Sửa', expectedVersion: 0 }))
      .rejects.toMatchObject({ status: HttpStatus.FORBIDDEN, response: { error: { code: 'POST_ACTION_FORBIDDEN' } } });
  });

  it('reports uncertain write outcomes without claiming success or definitive failure', async () => {
    repository.create.mockRejectedValue(new Neo4jWriteOutcomeUnknownError());
    await expect(service.create(viewerId, { content: 'Chưa rõ' })).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { error: { code: 'WRITE_OUTCOME_UNKNOWN' } },
    });
  });

  it('sorts equal-timestamp feed posts by descending UUID before limit plus one', async () => {
    repository.listFeed.mockResolvedValue([
      storedPost({ id: '11111111-1111-4111-8111-111111111112', authorId: friendId, createdAt: '2026-10-15T10:00:00.000Z' }),
      storedPost({ id: '11111111-1111-4111-8111-111111111113', authorId: viewerId, createdAt: '2026-10-15T10:00:00.000Z' }),
      storedPost({ id: '11111111-1111-4111-8111-111111111111', authorId: friendId, createdAt: '2026-10-14T10:00:00.000Z' }),
    ]);
    const page = await service.listFeed(viewerId, { limit: 2 });
    expect(page.items.map(({ id }) => id)).toEqual([
      '11111111-1111-4111-8111-111111111113',
      '11111111-1111-4111-8111-111111111112',
    ]);
    expect(page.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(page.pagination.nextCursor).toEqual(expect.any(String));
    expect(repository.listFeed).toHaveBeenCalledWith(expect.objectContaining({
      viewerId, perAuthorLimit: 3, fetchLimit: 3,
    }));
  });

  it('binds profile cursors to the requested member and returns member-not-found for missing profiles', async () => {
    repository.listProfile.mockResolvedValue({ memberExists: false, posts: [] });
    await expect(service.listProfile(viewerId, friendId, {})).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { error: { code: 'MEMBER_NOT_FOUND' } },
    });
    const feedCursor = encodePostsCursor({
      scope: 'feed', viewerId, authorId: null,
      lastCreatedAt: '2026-10-15T10:00:00.000Z',
      lastId: '33333333-3333-4333-8333-333333333333',
    });
    await expect(service.listProfile(viewerId, friendId, { cursor: feedCursor }))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });

  it('bounds read and mutation rates per authenticated user', async () => {
    for (let index = 0; index < 120; index += 1) await service.getPost(viewerId, storedPost().id);
    await expect(service.getPost(viewerId, storedPost().id)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds: expect.any(Number),
    });
    for (let index = 0; index < 20; index += 1) await service.create(friendId, { content: 'post' });
    await expect(service.create(friendId, { content: 'post' })).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
