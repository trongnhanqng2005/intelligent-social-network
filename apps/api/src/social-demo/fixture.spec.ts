import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { UsersRepository } from '../modules/users/users.repository.js';
import { FriendshipsRepository } from '../modules/friendships/friendships.repository.js';
import { PostsRepository } from '../modules/posts/posts.repository.js';
import { applyFixture } from './fixture.js';
import type { DemoManifest } from './manifest.js';

describe('applyFixture', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates a valid offline fixture distribution with locally verifiable password hashes', async () => {
    const manifest: DemoManifest = {
      datasetVersion: 1,
      database: 'offline',
      databaseId: 'offline',
      users: Array.from({ length: 12 }, (_, index) => ({
        id: randomUUID(),
        email: `demo-${index}@example.test`,
        password: `fixture-password-${index}-long`,
        displayName: `Thành viên ${index}`,
      })),
    };
    const passwords = new PasswordService();
    const passwordHashes = [];
    for (const user of manifest.users) passwordHashes.push(await passwords.hash(user.password));

    const posts = new Map<string, { authorId: string; visibility: string }>();
    const comments: Array<{ actorId: string; postId: string; content: string }> = [];
    const likes: Array<{ actorId: string; postId: string }> = [];
    const accepted: Array<[number, number]> = [
      [0,1],[0,2],[0,3],[1,2],[1,4],[1,5],[2,3],[2,5],[2,6],
      [3,4],[3,7],[4,5],[4,8],[5,6],[5,9],[6,7],[8,10],[10,11],
    ];

    jest.spyOn(AuthRepository.prototype, 'register').mockResolvedValue({} as never);
    jest.spyOn(UsersRepository.prototype, 'updateProfile').mockImplementation(async (patch) => ({
      status: 'success',
      profile: {
        id: patch.userId, displayName: patch.displayName ?? '', bio: patch.bio ?? '',
        location: patch.location ?? '', createdAt: '', updatedAt: '', version: 1,
      },
    } as never));
    jest.spyOn(FriendshipsRepository.prototype, 'createRequest').mockResolvedValue({ kind: 'success', result: {} } as never);
    jest.spyOn(FriendshipsRepository.prototype, 'actOnRequest').mockResolvedValue({ kind: 'success', result: {} } as never);
    jest.spyOn(PostsRepository.prototype, 'create').mockImplementation(async (input) => {
      posts.set(input.id, { authorId: input.authorId, visibility: input.visibility });
      return { ...input, version: 0, displayName: '', bio: '', location: '' } as never;
    });
    jest.spyOn(PostsRepository.prototype, 'createComment').mockImplementation(async (actorId, postId, input) => {
      comments.push({ actorId, postId, content: input.content });
      return {} as never;
    });
    jest.spyOn(PostsRepository.prototype, 'setLike').mockImplementation(async (actorId, postId) => {
      likes.push({ actorId, postId });
      return { liked: true };
    });

    await expect(applyFixture({
      driver: {} as never, database: 'offline', transaction: {} as never, manifest, passwordHashes,
    })).resolves.toEqual({ users: 12, friendships: 18, pending: 5, posts: 27, comments: 48, likes: 75 });

    expect(posts.size).toBe(27);
    expect(comments).toHaveLength(48);
    expect(likes).toHaveLength(75);
    for (const user of manifest.users) expect(await passwords.verify(passwordHashes[manifest.users.indexOf(user)]!, user.password)).toBe(true);

    for (const [postIndex, post] of [...posts.values()].entries()) {
      const postId = [...posts.keys()][postIndex]!;
      const ownerIndex = manifest.users.findIndex((user) => user.id === post.authorId);
      const validActor = (actorId: string) => {
        const actorIndex = manifest.users.findIndex((user) => user.id === actorId);
        if (actorIndex === ownerIndex) return false;
        return post.visibility === 'members' ||
          accepted.some(([a, b]) => (a === ownerIndex && b === actorIndex) || (b === ownerIndex && a === actorIndex));
      };
      const postComments = comments.filter((comment) => comment.postId === postId);
      const postLikes = likes.filter((like) => like.postId === postId);
      expect(postComments).toHaveLength(postIndex < 21 ? 2 : 1);
      expect(new Set(postComments.map((comment) => comment.actorId)).size).toBe(postComments.length);
      expect(postComments.every((comment) => validActor(comment.actorId))).toBe(true);
      expect(postLikes).toHaveLength(postIndex < 21 ? 3 : 2);
      expect(new Set(postLikes.map((like) => like.actorId)).size).toBe(postLikes.length);
      expect(postLikes.every((like) => validActor(like.actorId))).toBe(true);
    }
  });
});
