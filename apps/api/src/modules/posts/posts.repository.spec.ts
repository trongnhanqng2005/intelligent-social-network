import { createHash } from 'node:crypto';
import { PostsRepository } from './posts.repository.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const authorId = '22222222-2222-4222-8222-222222222222';
const postId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-10-15T10:00:00.000Z';

function record(values: Record<string, unknown>) {
  const keys = Object.keys(values);
  return {
    keys,
    get: (key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error(`No field ${key}`);
      return values[key];
    },
  };
}

function storedRecord(overrides: Record<string, unknown> = {}) {
  return record({
    id: postId,
    authorId,
    displayName: 'Bạn bè',
    bio: null,
    location: null,
    content: 'Xin chào',
    visibility: 'friends',
    createdAt,
    updatedAt: createdAt,
    version: 0,
    authorLinks: 1,
    authorCount: 1,
    ...overrides,
  });
}

describe('PostsRepository', () => {
  let transaction: { run: jest.Mock };
  let neo4j: { executeRead: jest.Mock; executeWriteOnce: jest.Mock };
  let repository: PostsRepository;

  beforeEach(() => {
    transaction = { run: jest.fn() };
    neo4j = {
      executeRead: jest.fn(async (work) => work(transaction)),
      executeWriteOnce: jest.fn(async (work) => work(transaction)),
    };
    repository = new PostsRepository(neo4j as never);
  });

  it('creates through the single-run transaction using stable supplied values and verifies one author edge', async () => {
    transaction.run.mockResolvedValue({ records: [storedRecord({ authorId: viewerId, authorLinks: 1,
      authorCount: 1, relationshipCount: 1 })] });
    const input = {
      id: postId, authorId: viewerId, content: 'Xin chào', visibility: 'friends' as const, createdAt,
    };

    await expect(repository.create(input)).resolves.toMatchObject({ id: postId, authorId: viewerId, version: 0 });

    expect(neo4j.executeWriteOnce).toHaveBeenCalledTimes(1);
    const [query, parameters] = transaction.run.mock.calls[0]!;
    expect(String(query)).toContain('MERGE (post:Post {id: $id})');
    expect(String(query)).toContain('MERGE (author)-[:AUTHORED]->(post)');
    expect(String(query)).toContain('count(DISTINCT relationship) AS relationshipCount');
    expect(String(query)).not.toContain('CREATE (post');
    expect(parameters).toMatchObject(input);
  });

  it('enforces current canonical accepted friendship in detail visibility before returning a Post', async () => {
    transaction.run.mockResolvedValue({ records: [storedRecord()] });

    await repository.findVisible(viewerId, postId);

    const [query, parameters] = transaction.run.mock.calls[0]!;
    expect(parameters).toEqual({ viewerId, postId });
    expect(String(query)).toMatch(/RETURN count\(owned\) AS authorCount\s*\}\s*WITH viewer, author, post, authorLinks, authorCount\s*WHERE/u);
    expect(String(query)).toContain("pair.requestStatus = 'ACCEPTED'");
    expect(String(query)).toContain('pair.friendshipId = friendship.id');
    expect(String(query)).toContain('pair.friendsSince = friendship.since');
    expect(String(query)).toContain("post.visibility = 'members'");
  });

  it('projects interaction fields in transaction-scoped visibility reads', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, likeCount: 2, commentCount: 3, likedByViewer: true })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, version: 1, likeCount: 2, commentCount: 3, likedByViewer: true })] });
    await repository.update({ viewerId: authorId, postId, content: 'edit', expectedVersion: 0, updatedAt: createdAt });
    const visibilityQuery = String(transaction.run.mock.calls[1]![0]);
    expect(visibilityQuery).toContain('AS likeCount');
    expect(visibilityQuery).toContain('AS commentCount');
    expect(visibilityQuery).toContain('AS likedByViewer');
  });

  it('keeps comment retry identity and original content hash stable across edits', async () => {
    const originalHash = createHash('sha256').update('original').digest('hex');
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, likeCount: 0, commentCount: 0, likedByViewer: false })] })
      .mockResolvedValueOnce({ records: [record({
        id: '44444444-4444-4444-8444-444444444444', clientId: '55555555-5555-4555-8555-555555555555',
        content: 'edited', deleted: false, originalContentHash: originalHash,
        createdAt, updatedAt: createdAt, version: 1, authorId: viewerId, displayName: 'Viewer',
      })] });
    const result = await repository.createComment(viewerId, postId, {
      clientId: '55555555-5555-4555-8555-555555555555', content: 'original',
    });
    expect(result).toMatchObject({ comment: { content: 'edited', version: 1 } });
    const query = String(transaction.run.mock.calls[2]![0]);
    expect(query).toContain('comment.originalContentHash=$contentHash');
    expect(query).toContain('MERGE (comment:Comment {retryKey:$key})');
  });

  it('locks the existing friendship pair and rechecks visibility before liking a friends-only Post', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ pairKey: `${viewerId}:${authorId}`, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [] });

    await repository.setLike(viewerId, postId, true);

    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[0]).toMatch(/SET post\.version = post\.version \+ 1\s+WITH post\s+SET post\.version = post\.version - 1\s+RETURN post\.id AS id, post\.version AS version/u);
    expect(queries[2]).toContain('MATCH (pair:FriendshipPair {pairKey: $pairKey})');
    expect(queries[2]).toMatch(/SET pair\.version = pair\.version \+ 1\s+WITH pair\s+SET pair\.version = pair\.version - 1\s+RETURN pair\.pairKey AS pairKey, pair\.version AS version/u);
    expect(queries[3]).toContain('RETURN post.id AS id');
    expect(queries[4]).toContain('MERGE (viewer)-[:LIKED]->(post)');
  });

  it('retries a definite deadlock once for a like mutation', async () => {
    const deadlock = { code: 'Neo.TransientError.Transaction.DeadlockDetected' };
    neo4j.executeWriteOnce
      .mockRejectedValueOnce(deadlock)
      .mockImplementationOnce(async (work) => work(transaction));
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord({ visibility: 'members' })] })
      .mockResolvedValueOnce({ records: [] });

    await expect(repository.setLike(viewerId, postId, true)).resolves.toEqual({ liked: true });

    expect(neo4j.executeWriteOnce).toHaveBeenCalledTimes(2);
    expect(transaction.run).toHaveBeenCalledTimes(3);
  });

  it('does not retry unknown or non-deadlock failures for a like mutation', async () => {
    const unknown = { code: 'Neo.ClientError.Transaction.CommitFailed' };
    neo4j.executeWriteOnce.mockRejectedValueOnce(unknown);

    await expect(repository.setLike(viewerId, postId, true)).rejects.toBe(unknown);
    expect(neo4j.executeWriteOnce).toHaveBeenCalledTimes(1);
  });

  it('locks the existing friendship pair and rechecks visibility before creating a friends-only comment', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ pairKey: `${viewerId}:${authorId}`, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({
        id: '44444444-4444-4444-8444-444444444444',
        clientId: '55555555-5555-4555-8555-555555555555', content: 'hello', deleted: false,
        originalContentHash: createHash('sha256').update('hello').digest('hex'),
        createdAt, updatedAt: createdAt, version: 0, authorId: viewerId, displayName: 'Viewer',
      })] });

    await repository.createComment(viewerId, postId, {
      clientId: '55555555-5555-4555-8555-555555555555', content: 'hello',
    });

    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[0]).toMatch(/SET post\.version = post\.version \+ 1\s+WITH post\s+SET post\.version = post\.version - 1\s+RETURN post\.id AS id, post\.version AS version/u);
    expect(queries[2]).toContain('MATCH (pair:FriendshipPair {pairKey: $pairKey})');
    expect(queries[3]).toContain('RETURN post.id AS id');
    expect(queries[4]).toContain('MERGE (comment:Comment {retryKey:$key})');
  });

  it('binds canonicalFriendship to author and serializes friend comment writes with pair revocation', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ pairKey: `${viewerId}:${authorId}`, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ version: 0, deleted: false, authorId: viewerId })] })
      .mockResolvedValueOnce({ records: [record({
        id: '44444444-4444-4444-8444-444444444444', clientId: '55555555-5555-4555-8555-555555555555',
        content: 'updated', deleted: false, createdAt, updatedAt: createdAt, version: 1,
        authorId: viewerId, displayName: 'Viewer',
      })] });

    await repository.updateComment(viewerId, postId, '44444444-4444-4444-8444-444444444444', 'updated', 0);

    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[0]).toMatch(/SET post\.version = post\.version \+ 1\s+WITH post\s+SET post\.version = post\.version - 1\s+RETURN post\.id AS id, post\.version AS version/u);
    expect(queries[2]).toContain('MATCH (pair:FriendshipPair {pairKey: $pairKey})');
    expect(queries[2]).toMatch(/SET pair\.version = pair\.version \+ 1\s+WITH pair\s+SET pair\.version = pair\.version - 1\s+RETURN pair\.pairKey AS pairKey, pair\.version AS version/u);
    expect(queries[2]).not.toContain('MERGE');
    expect(queries[3]).toMatch(/MATCH \(viewer:User \{id: \$viewerId\}\), \(post:Post/u);
    expect(queries[5]).toContain('MATCH (author:User)-[:AUTHORED]->(post)');
    expect(queries[5]).toContain('MATCH (viewer)-[friendship:FRIEND_WITH]-(author)');
    expect(queries[5]).not.toContain('MATCH (owner:User)');
  });

  it('uses the canonical author binding and pair lock before deleting a friend comment', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ pairKey: `${viewerId}:${authorId}`, version: 0 })] })
      .mockResolvedValueOnce({ records: [storedRecord()] })
      .mockResolvedValueOnce({ records: [record({ version: 0, deleted: false, authorId: viewerId })] })
      .mockResolvedValueOnce({ records: [record({ changed: 1 })] });

    await repository.deleteComment(viewerId, postId, '44444444-4444-4444-8444-444444444444', 0);

    const queries = transaction.run.mock.calls.map(([query]) => String(query));
    expect(queries[2]).toMatch(/SET pair\.version = pair\.version \+ 1\s+WITH pair\s+SET pair\.version = pair\.version - 1\s+RETURN pair\.pairKey AS pairKey, pair\.version AS version/u);
    expect(queries[3]).toContain('RETURN post.id AS id');
    expect(queries[5]).toContain('MATCH (author:User)-[:AUTHORED]->(post)');
    expect(queries[5]).toContain('MATCH (viewer)-[friendship:FRIEND_WITH]-(author)');
    expect(queries[5]).not.toContain('MATCH (owner:User)');
  });

  it('filters profile visibility and keyset tuple in Neo4j before bounded pagination', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: authorId })] })
      .mockResolvedValueOnce({ records: [] });
    const cursor = { scope: 'profile-posts' as const, viewerId, authorId,
      lastCreatedAt: createdAt, lastId: postId };

    await repository.listProfile({ viewerId, authorId, cursor, fetchLimit: 21 });

    const [query, parameters] = transaction.run.mock.calls[1]!;
    expect(String(query)).toContain("post.visibility IN ['members', 'friends']");
    expect(String(query)).toContain('post.createdAt < datetime($cursorCreatedAt)');
    expect(String(query)).toContain('post.createdAt = datetime($cursorCreatedAt) AND post.id < $cursorId');
    expect(String(query)).toContain('ORDER BY post.createdAt DESC, post.id DESC LIMIT $fetchLimit');
    expect(String(query)).not.toMatch(/\bSKIP\b|\bOFFSET\b/iu);
    expect(parameters).toMatchObject({ viewerId, authorId, cursorCreatedAt: createdAt, cursorId: postId });
  });

  it('limits per author and globally after canonical friendship and database-side visibility filtering', async () => {
    transaction.run.mockResolvedValue({ records: [] });
    await repository.listFeed({
      viewerId,
      cursor: { scope: 'feed', viewerId, authorId: null, lastCreatedAt: createdAt, lastId: postId },
      perAuthorLimit: 21,
      fetchLimit: 21,
    });

    const [query, parameters] = transaction.run.mock.calls[0]!;
    expect(String(query)).toContain("pair.requestStatus = 'ACCEPTED'");
    expect(String(query)).toContain('pair.friendshipId = edge.id');
    expect(String(query)).toContain("post.visibility IN ['members', 'friends']");
    expect(String(query)).toContain('USING INDEX post:Post(authorId, createdAt, id)');
    expect(String(query)).toContain('post.authorId IN [author.id]');
    expect(String(query)).toContain('post.createdAt IS NOT NULL');
    expect(String(query)).toContain('post.id IS NOT NULL');
    expect(String(query)).toContain('WITH DISTINCT viewer, authorId, isOwner');
    expect(String(query)).toContain('WITH DISTINCT viewer, author, isOwner');
    expect(String(query)).toContain('CALL (author, isOwner, viewer)');
    expect(String(query)).toMatch(/LIMIT \$perAuthorLimit[\s\S]*CALL \(post\).*AS likeCount[\s\S]*CALL \(post\).*AS commentCount[\s\S]*CALL \(viewer, post\).*AS likedByViewer/u);
    expect(String(query)).toContain('ORDER BY sortCreatedAt DESC, id DESC LIMIT $perAuthorLimit');
    expect(String(query)).toContain('ORDER BY sortCreatedAt DESC, id DESC LIMIT $fetchLimit');
    expect(String(query)).not.toMatch(/\bSKIP\b|\bOFFSET\b/iu);
    expect(parameters).toMatchObject({ viewerId, perAuthorLimit: expect.anything(), fetchLimit: expect.anything(),
      cursorCreatedAt: createdAt, cursorId: postId });
  });

  it('orders Feed candidates by Neo4j temporal values before each author and global page limit', async () => {
    transaction.run.mockResolvedValue({ records: [] });
    await repository.listFeed({ viewerId, perAuthorLimit: 3, fetchLimit: 3 });

    const query = String(transaction.run.mock.calls[0]![0]);
    expect(query).toContain('post.createdAt AS sortCreatedAt');
    expect(query).toContain('ORDER BY sortCreatedAt DESC, id DESC LIMIT $perAuthorLimit');
    expect(query).toContain('ORDER BY sortCreatedAt DESC, id DESC LIMIT $fetchLimit');
    expect(query).toMatch(/ORDER BY sortCreatedAt DESC, id DESC LIMIT \$fetchLimit\s+RETURN[\s\S]*toString\(sortCreatedAt\) AS createdAt/u);
    expect(query).not.toContain('ORDER BY createdAt DESC, id DESC');
    expect(query).not.toContain('toString(post.createdAt)');

  });

  it('serializes edit decisions under a Post write lock and compares expectedVersion before mutation', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, content: 'Đã sửa', version: 1 })] });

    const outcome = await repository.update({
      viewerId, postId, content: 'Đã sửa', expectedVersion: 0, updatedAt: '2026-10-15T10:01:00.000Z',
    });

    expect(outcome).toMatchObject({ content: 'Đã sửa', version: 1 });
    expect(transaction.run).toHaveBeenCalledTimes(3);
    expect(String(transaction.run.mock.calls[0]![0])).toMatch(/SET post\.version = post\.version \+ 1\s+WITH post\s+SET post\.version = post\.version - 1\s+RETURN post\.id AS id, post\.version AS version/u);
    const updateQuery = String(transaction.run.mock.calls[2]![0]);
    expect(updateQuery).toContain('WHERE post.version = $expectedVersion');
    for (const alias of ['likeCount', 'commentCount', 'likedByViewer']) {
      expect(updateQuery.match(new RegExp(`\\bAS ${alias}\\b`, 'gu'))).toHaveLength(1);
    }
    expect(neo4j.executeWriteOnce).toHaveBeenCalledTimes(1);
  });

  it('returns a stale conflict after locking without attempting an update', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, version: 1 })] });

    await expect(repository.update({
      viewerId, postId, content: 'Đã sửa', expectedVersion: 0, updatedAt: '2026-10-15T10:01:00.000Z',
    })).resolves.toBe('conflict');
    expect(transaction.run).toHaveBeenCalledTimes(2);
  });

  it('returns a conflict when Neo4j aborts an edit as a deadlock victim', async () => {
    neo4j.executeWriteOnce.mockRejectedValue({ code: 'Neo.TransientError.Transaction.DeadlockDetected' });

    await expect(repository.update({
      viewerId, postId, content: 'Đã sửa', expectedVersion: 0, updatedAt: '2026-10-15T10:01:00.000Z',
    })).resolves.toBe('conflict');
  });

  it('deletes only the verified sole owner edge and Post node', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, relationshipCount: 1 })] })
      .mockResolvedValueOnce({ records: [record({ deleted: 1 })] });

    await expect(repository.delete({ viewerId, postId, expectedVersion: 0 })).resolves.toBe('deleted');

    const deleteQuery = String(transaction.run.mock.calls[2]![0]);
    expect(deleteQuery).toContain('DELETE authored, post');
    expect(deleteQuery).not.toMatch(/DETACH\s+DELETE/iu);
  });

  it('deletes only scoped like/comment relationships and does not detach unrelated data', async () => {
    transaction.run
      .mockResolvedValueOnce({ records: [record({ id: postId })] })
      .mockResolvedValueOnce({ records: [storedRecord({ authorId: viewerId, relationshipCount: 3 })] })
      .mockResolvedValueOnce({ records: [record({ deleted: 1 })] });

    await expect(repository.delete({ viewerId, postId, expectedVersion: 0 })).resolves.toBe('deleted');
    const deleteQuery = String(transaction.run.mock.calls[2]![0]);
    expect(deleteQuery).toContain('collect(DISTINCT like) AS likes');
    expect(deleteQuery).toContain('collect(DISTINCT onPost) AS postEdges');
    expect(deleteQuery).toContain('collect(DISTINCT written) AS writtenEdges');
    expect(deleteQuery).toMatch(/OPTIONAL MATCH \(comment:Comment\)-\[onPost:ON_POST\]->\(post\)\s+OPTIONAL MATCH \(:User\)-\[written:WROTE_COMMENT\]->\(comment\)\s+WITH authored,post,collect\(DISTINCT comment\) AS comments,collect\(DISTINCT onPost\) AS postEdges,collect\(DISTINCT written\) AS writtenEdges/u);
    expect(deleteQuery).not.toMatch(/DETACH\s+DELETE/iu);
  });

  it('returns a conflict when Neo4j aborts a delete as a deadlock victim', async () => {
    neo4j.executeWriteOnce.mockRejectedValue({ code: 'Neo.TransientError.Transaction.DeadlockDetected' });

    await expect(repository.delete({ viewerId, postId, expectedVersion: 0 })).resolves.toBe('conflict');
  });

  it('makes a stale edit lose to the preceding edit and a delete lose to the updated version', async () => {
    let version = 0;
    let deleted = false;
    transaction.run.mockImplementation(async (query: unknown, parameters?: Record<string, unknown>) => {
      const text = String(query);
      if (text.includes('SET post.version = post.version + 1')) {
        return { records: deleted ? [] : [record({ id: postId })] };
      }
      if (text.includes('MATCH (viewer:User {id: $viewerId}), (post:Post {id: $postId})')) {
        return { records: deleted ? [] : [storedRecord({ authorId: viewerId, version, relationshipCount: 1 })] };
      }
      if (text.includes('SET post.content =')) {
        if (version !== parameters?.expectedVersion) return { records: [] };
        version += 1;
        return { records: [storedRecord({
          authorId: viewerId, content: String(parameters.content), version, relationshipCount: 1,
        })] };
      }
      if (text.includes('DELETE authored, post')) {
        if (version !== parameters?.expectedVersion) return { records: [] };
        deleted = true;
        return { records: [record({ deleted: 1 })] };
      }
      throw new Error(`Unexpected Post query: ${text}`);
    });

    const firstEdit = await repository.update({
      viewerId, postId, content: 'Lần sửa đầu', expectedVersion: 0, updatedAt: '2026-10-15T10:01:00.000Z',
    });
    const staleEdit = await repository.update({
      viewerId, postId, content: 'Lần sửa cạnh tranh', expectedVersion: 0, updatedAt: '2026-10-15T10:02:00.000Z',
    });
    const staleDelete = await repository.delete({ viewerId, postId, expectedVersion: 0 });

    expect(firstEdit).toMatchObject({ version: 1, content: 'Lần sửa đầu' });
    expect(staleEdit).toBe('conflict');
    expect(staleDelete).toBe('conflict');
    expect(version).toBe(1);
    expect(deleted).toBe(false);
  });
});
