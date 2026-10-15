import { Injectable } from '@nestjs/common';
import { int, type Transaction } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import { PostGraphInvariantError } from './posts.errors.js';
import type { PostsCursor } from './post-pagination.js';
import type { PostVisibility, StoredPost } from './posts.types.js';

const canonicalFriendship = `
  EXISTS {
    MATCH (viewer)-[friendship:FRIEND_WITH]-(author)
    MATCH (low:User)-[canonical:FRIEND_WITH]->(high:User)
    MATCH (pair:FriendshipPair)
    WHERE canonical.id = friendship.id AND canonical.pairKey = friendship.pairKey AND
          pair.pairKey = friendship.pairKey AND pair.requestStatus = 'ACCEPTED' AND pair.friendshipId = friendship.id AND
          pair.friendsSince = friendship.since AND canonical.since = friendship.since AND
          pair.lowUserId = low.id AND pair.highUserId = high.id AND
          ((low.id = viewer.id AND high.id = author.id) OR
           (high.id = viewer.id AND low.id = author.id))
  }
`;

export const postsFeedQuery = `
  MATCH (viewer:User {id: $viewerId})
  CALL (viewer) {
    RETURN viewer.id AS authorId, true AS isOwner
    UNION
    MATCH (viewer)-[edge:FRIEND_WITH]-(friend:User)
    MATCH (low:User)-[canonical:FRIEND_WITH]->(high:User)
    MATCH (pair:FriendshipPair)
    WHERE canonical.id = edge.id AND canonical.pairKey = edge.pairKey AND
          pair.pairKey = edge.pairKey AND pair.requestStatus = 'ACCEPTED' AND pair.friendshipId = edge.id AND
          pair.friendsSince = edge.since AND canonical.since = edge.since AND
          pair.lowUserId = low.id AND pair.highUserId = high.id AND
          ((low.id = viewer.id AND high.id = friend.id) OR
           (high.id = viewer.id AND low.id = friend.id))
    RETURN friend.id AS authorId, false AS isOwner
  }
  WITH DISTINCT authorId, isOwner
  MATCH (author:User)
  WHERE author.id = authorId
      WITH DISTINCT author, isOwner
      CALL (author, isOwner) {
        MATCH (post:Post)
        USING INDEX post:Post(authorId, createdAt, id)
        WHERE post.authorId IN [author.id] AND post.createdAt IS NOT NULL AND post.id IS NOT NULL
        MATCH (author)-[authored:AUTHORED]->(post)
        WITH author, isOwner, post, count(authored) AS authorLinks
    WHERE post.visibility IN ['members', 'friends'] AND
          (isOwner OR post.visibility = 'members' OR post.visibility = 'friends') AND
          ($cursorCreatedAt IS NULL OR post.createdAt < datetime($cursorCreatedAt) OR
           (post.createdAt = datetime($cursorCreatedAt) AND post.id < $cursorId))
        CALL (post) {
          MATCH (:User)-[owned:AUTHORED]->(post)
      RETURN count(owned) AS authorCount
    }
     RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
            post.visibility AS visibility, post.createdAt AS sortCreatedAt,
            post.updatedAt AS sortUpdatedAt, post.version AS version,
            author.displayName AS displayName, author.bio AS bio, author.location AS location,
            authorLinks, authorCount
     ORDER BY sortCreatedAt DESC, id DESC LIMIT $perAuthorLimit
   }
   WITH id, authorId, content, visibility, sortCreatedAt, sortUpdatedAt, version,
        displayName, bio, location, authorLinks, authorCount
   ORDER BY sortCreatedAt DESC, id DESC LIMIT $fetchLimit
   RETURN id, authorId, content, visibility, toString(sortCreatedAt) AS createdAt,
          toString(sortUpdatedAt) AS updatedAt, version,
          displayName, bio, location, authorLinks, authorCount
`;

@Injectable()
export class PostsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(input: {
    id: string;
    authorId: string;
    content: string;
    visibility: PostVisibility;
    createdAt: string;
  }): Promise<StoredPost | undefined> {
    return this.neo4j.executeWriteOnce(async (transaction) => {
      const result = await transaction.run(
        `MATCH (author:User {id: $authorId})
         MERGE (post:Post {id: $id})
         ON CREATE SET post.authorId = $authorId, post.content = $content,
                       post.visibility = $visibility, post.createdAt = datetime($createdAt),
                       post.updatedAt = datetime($createdAt), post.version = 0
         MERGE (author)-[:AUTHORED]->(post)
         WITH author, post
         CALL (post) {
           MATCH (:User)-[authored:AUTHORED]->(post)
           RETURN count(authored) AS authorLinks
         }
         OPTIONAL MATCH (post)-[relationship]-()
         RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                authorLinks, authorLinks AS authorCount,
                count(DISTINCT relationship) AS relationshipCount`,
        input,
      );
      const record = result.records[0];
      if (!record) return undefined;
      const post = readStoredPost(record);
      if (post.authorId !== input.authorId || post.content !== input.content ||
          post.visibility !== input.visibility || Date.parse(post.createdAt) !== Date.parse(input.createdAt) ||
          Date.parse(post.updatedAt) !== Date.parse(input.createdAt) || post.version !== 0 ||
          post.authorCount !== 1 || post.relationshipCount !== 1) {
        throw new PostGraphInvariantError();
      }
      return post;
    });
  }

  async findVisible(viewerId: string, postId: string): Promise<StoredPost | undefined> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (viewer:User {id: $viewerId})
         MATCH (author:User)-[authored:AUTHORED]->(post:Post {id: $postId})
         WITH viewer, author, post, count(authored) AS authorLinks
          CALL (post) {
            MATCH (:User)-[owned:AUTHORED]->(post)
            RETURN count(owned) AS authorCount
          }
          WITH viewer, author, post, authorLinks, authorCount
          WHERE post.authorId = author.id AND
               (viewer.id = author.id OR post.visibility = 'members' OR
                (post.visibility = 'friends' AND ${canonicalFriendship}))
         RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                authorLinks, authorCount`,
        { viewerId, postId },
      );
      if (result.records.length > 1) throw new PostGraphInvariantError();
      return result.records[0] ? readStoredPost(result.records[0]) : undefined;
    });
  }

  async listProfile(input: {
    viewerId: string;
    authorId: string;
    cursor?: PostsCursor;
    fetchLimit: number;
  }): Promise<{ memberExists: boolean; posts: StoredPost[] }> {
    return this.neo4j.executeRead(async (transaction) => {
      const member = await transaction.run(
        'MATCH (member:User {id: $authorId}) RETURN member.id AS id LIMIT 1',
        { authorId: input.authorId },
      );
      if (!member.records[0]) return { memberExists: false, posts: [] };
      const result = await transaction.run(
        `MATCH (viewer:User {id: $viewerId}), (author:User {id: $authorId})
         MATCH (author)-[authored:AUTHORED]->(post:Post {authorId: $authorId})
         WITH viewer, author, post, count(authored) AS authorLinks
         WHERE post.visibility IN ['members', 'friends'] AND
               (viewer.id = author.id OR post.visibility = 'members' OR
                (post.visibility = 'friends' AND ${canonicalFriendship})) AND
               ($cursorCreatedAt IS NULL OR post.createdAt < datetime($cursorCreatedAt) OR
                (post.createdAt = datetime($cursorCreatedAt) AND post.id < $cursorId))
          CALL (post) {
            MATCH (:User)-[owned:AUTHORED]->(post)
           RETURN count(owned) AS authorCount
         }
         RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                authorLinks, authorCount
         ORDER BY post.createdAt DESC, post.id DESC LIMIT $fetchLimit`,
        {
          viewerId: input.viewerId,
          authorId: input.authorId,
          cursorCreatedAt: input.cursor?.lastCreatedAt ?? null,
          cursorId: input.cursor?.lastId ?? null,
          fetchLimit: int(input.fetchLimit),
        },
      );
      return { memberExists: true, posts: result.records.map(readStoredPost) };
    });
  }

  async listFeed(input: {
    viewerId: string;
    cursor?: PostsCursor;
    perAuthorLimit: number;
    fetchLimit: number;
  }): Promise<StoredPost[]> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        postsFeedQuery,
        {
          viewerId: input.viewerId,
          cursorCreatedAt: input.cursor?.lastCreatedAt ?? null,
          cursorId: input.cursor?.lastId ?? null,
          perAuthorLimit: int(input.perAuthorLimit),
          fetchLimit: int(input.fetchLimit),
        },
      );
      return result.records.map(readStoredPost);
    });
  }

  async update(input: {
    viewerId: string;
    postId: string;
    content: string;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<'not-found' | 'forbidden' | 'conflict' | StoredPost> {
    try {
      return await this.neo4j.executeWriteOnce(async (transaction) => {
        const locked = await lockPost(transaction, input.postId);
        if (!locked) return 'not-found';
        const current = await findVisibleInTransaction(transaction, input.viewerId, input.postId);
        if (!current) return 'not-found';
        if (current.authorId !== input.viewerId) return 'forbidden';
        if (current.version !== input.expectedVersion) return 'conflict';
        const result = await transaction.run(
          `MATCH (author:User {id: $viewerId})-[authored:AUTHORED]->(post:Post {
             id: $postId, authorId: $viewerId
           })
           WHERE post.version = $expectedVersion
           SET post.content = $content, post.updatedAt = datetime($updatedAt),
               post.version = post.version + 1
           WITH author, post, authored
           CALL (post) {
             MATCH (:User)-[owned:AUTHORED]->(post)
             RETURN count(owned) AS authorCount
           }
           RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                  post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                  toString(post.updatedAt) AS updatedAt, post.version AS version,
                  author.displayName AS displayName, author.bio AS bio, author.location AS location,
                  1 AS authorLinks, authorCount`,
          input,
        );
        const record = result.records[0];
        if (!record) return 'conflict';
        const post = readStoredPost(record);
        if (post.authorCount !== 1 || post.authorId !== input.viewerId || post.version !== input.expectedVersion + 1) {
          throw new PostGraphInvariantError();
        }
        return post;
      });
    } catch (error) {
      if (isPostWriteDeadlock(error)) return 'conflict';
      throw error;
    }
  }

  async delete(input: {
    viewerId: string;
    postId: string;
    expectedVersion: number;
  }): Promise<'not-found' | 'forbidden' | 'conflict' | 'deleted'> {
    try {
      return await this.neo4j.executeWriteOnce(async (transaction) => {
        const locked = await lockPost(transaction, input.postId);
        if (!locked) return 'not-found';
        const current = await findVisibleInTransaction(transaction, input.viewerId, input.postId, true);
        if (!current) return 'not-found';
        if (current.authorId !== input.viewerId) return 'forbidden';
        if (current.version !== input.expectedVersion) return 'conflict';
        if (current.relationshipCount !== 1) throw new PostGraphInvariantError();
        const result = await transaction.run(
          `MATCH (author:User {id: $viewerId})-[authored:AUTHORED]->(post:Post {
             id: $postId, authorId: $viewerId
           })
           WHERE post.version = $expectedVersion
           DELETE authored, post
           RETURN count(authored) AS deleted`,
          input,
        );
        return asNumber(result.records[0]?.get('deleted')) === 1 ? 'deleted' : 'conflict';
      });
    } catch (error) {
      if (isPostWriteDeadlock(error)) return 'conflict';
      throw error;
    }
  }
}

function isPostWriteDeadlock(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    error.code === 'Neo.TransientError.Transaction.DeadlockDetected';
}

async function lockPost(transaction: Transaction, postId: string): Promise<boolean> {
  const result = await transaction.run(
    `MATCH (post:Post {id: $postId})
     SET post.version = post.version + 0
     RETURN post.id AS id`,
    { postId },
  );
  return result.records.length === 1;
}

async function findVisibleInTransaction(
  transaction: Transaction,
  viewerId: string,
  postId: string,
  includeRelationshipCount = false,
): Promise<StoredPost | undefined> {
  const result = await transaction.run(
    `MATCH (viewer:User {id: $viewerId}), (post:Post {id: $postId})
     CALL (post) {
       MATCH (author:User)-[authored:AUTHORED]->(post)
       RETURN author, count(authored) AS authorLinks
     }
     CALL (post) {
       MATCH (:User)-[owned:AUTHORED]->(post)
       RETURN count(owned) AS authorCount
     }
     ${includeRelationshipCount ? 'OPTIONAL MATCH (post)-[relationship]-()' : ''}
     WITH viewer, author, post, authorLinks, authorCount${includeRelationshipCount ? ', count(DISTINCT relationship) AS relationshipCount' : ''}
     WHERE post.authorId = author.id AND
           (viewer.id = author.id OR post.visibility = 'members' OR
            (post.visibility = 'friends' AND ${canonicalFriendship}))
     RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
            post.visibility AS visibility, toString(post.createdAt) AS createdAt,
            toString(post.updatedAt) AS updatedAt, post.version AS version,
            author.displayName AS displayName, author.bio AS bio, author.location AS location,
            authorLinks, authorCount${includeRelationshipCount ? ', relationshipCount' : ''}`,
    { viewerId, postId },
  );
  if (result.records.length > 1) throw new PostGraphInvariantError();
  return result.records[0] ? readStoredPost(result.records[0]) : undefined;
}

function readStoredPost(record: { get(key: string): unknown; keys?: readonly PropertyKey[] }): StoredPost {
  const visibility = String(record.get('visibility'));
  if (visibility !== 'members' && visibility !== 'friends') throw new PostGraphInvariantError();
  const post: StoredPost = {
    id: String(record.get('id')),
    authorId: String(record.get('authorId')),
    displayName: String(record.get('displayName')),
    bio: nullableString(record.get('bio')),
    location: nullableString(record.get('location')),
    content: String(record.get('content')),
    visibility,
    createdAt: normalizeInstant(record.get('createdAt')),
    updatedAt: normalizeInstant(record.get('updatedAt')),
    version: asNumber(record.get('version')),
    authorLinks: asNumber(record.get('authorLinks')),
    authorCount: asNumber(record.get('authorCount')),
  };
  if (record.keys?.includes('relationshipCount')) {
    const relationshipCount = record.get('relationshipCount');
    if (relationshipCount !== null && relationshipCount !== undefined) {
      post.relationshipCount = asNumber(relationshipCount);
    }
  }
  if (!post.id || !post.authorId || !post.displayName || !Number.isSafeInteger(post.version) ||
      post.version < 0 || post.authorLinks !== 1 || post.authorCount !== 1) {
    throw new PostGraphInvariantError();
  }
  return post;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeInstant(value: unknown): string {
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new PostGraphInvariantError();
  return new Date(timestamp).toISOString();
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number.NaN;
}
