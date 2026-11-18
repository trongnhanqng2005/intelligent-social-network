import { int } from 'neo4j-driver';
import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import type { Comment, Post, PostMedia } from './posts.types.js';

@Injectable()
export class PostsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async create(input: { id: string; authorId: string; content: string; now: string }): Promise<Post | undefined> {
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (author:User {id: $authorId})
         CREATE (post:Post {id: $id, authorId: $authorId, content: $content,
           createdAt: datetime($now), updatedAt: datetime($now)})
         RETURN post.id AS id, post.content AS content, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, author.id AS authorId, author.displayName AS displayName,
                0 AS likeCount, 0 AS commentCount, 0 AS shareCount, false AS likedByMe, false AS sharedByMe,
                [] AS media`,
        input,
      );
      return result.records[0] ? readPost(result.records[0], input.authorId) : undefined;
    });
  }

  async update(input: { id: string; authorId: string; content: string; now: string }): Promise<'not-found' | 'forbidden' | Post> {
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (post:Post {id: $id})
         OPTIONAL MATCH (author:User {id: post.authorId})
         WITH post, author
         WHERE post.authorId = $authorId
         SET post.content = $content, post.updatedAt = datetime($now)
         RETURN post.id AS id, post.content AS content, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, author.id AS authorId, author.displayName AS displayName,
                0 AS likeCount, 0 AS commentCount, 0 AS shareCount, false AS likedByMe, false AS sharedByMe,
                [] AS media`,
        input,
      );
      if (result.records[0]) return readPost(result.records[0], input.authorId);
      const exists = await transaction.run('MATCH (post:Post {id: $id}) RETURN post.authorId AS authorId', input);
      return exists.records.length ? 'forbidden' : 'not-found';
    });
  }

  async remove(id: string, authorId: string): Promise<'not-found' | 'forbidden' | 'deleted'> {
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (post:Post {id: $id})
         WITH post, post.authorId = $authorId AS owned
         FOREACH (_ IN CASE WHEN owned THEN [1] ELSE [] END | DELETE post)
         RETURN owned`,
        { id, authorId },
      );
      if (!result.records.length) return 'not-found';
      return result.records[0]?.get('owned') ? 'deleted' : 'forbidden';
    });
  }

  async listFeed(input: {
    userId: string; cursor?: { createdAt: string; id: string }; fetchLimit: number;
  }): Promise<Post[]> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (post:Post)
         MATCH (author:User {id: post.authorId})
         WHERE (post.authorId = $userId OR EXISTS {
           MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author)
         })
         AND ($cursorCreatedAt IS NULL OR post.createdAt < datetime($cursorCreatedAt) OR
           (post.createdAt = datetime($cursorCreatedAt) AND post.id < $cursorId))
         CALL {
           WITH post
           MATCH (media:PostMedia)
           WHERE media.postId = post.id
           RETURN collect({
             id: media.id, postId: media.postId, mediaType: media.mediaType,
             mimeType: media.mimeType, sizeBytes: media.sizeBytes,
             originalName: media.originalName, createdAt: toString(media.createdAt),
             url: '/posts/media/' + media.id
           }) AS media
         }
         RETURN post.id AS id, post.content AS content, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, author.id AS authorId, author.displayName AS displayName,
                count { (post)<-[:LIKED]-() } AS likeCount,
                count { MATCH (comment:Comment) WHERE comment.postId = post.id RETURN comment } AS commentCount,
                count { (post)<-[:SHARED]-() } AS shareCount,
                EXISTS { MATCH (viewer:User {id: $userId})-[:LIKED]->(post) } AS likedByMe,
                EXISTS { MATCH (viewer:User {id: $userId})-[:SHARED]->(post) } AS sharedByMe,
                media AS media
         ORDER BY post.createdAt DESC, post.id DESC LIMIT $fetchLimit`,
        {
          userId: input.userId,
          cursorCreatedAt: input.cursor?.createdAt ?? null,
          cursorId: input.cursor?.id ?? '',
          fetchLimit: int(input.fetchLimit),
        },
      );
      return result.records.map((record) => readPost(record, input.userId));
    });
  }

  async createMedia(input: {
    id: string; postId: string; userId: string; mediaType: 'image' | 'video';
    mimeType: string; sizeBytes: number; originalName: string; storageExtension: string; now: string;
  }): Promise<PostMedia | 'not-found' | 'forbidden'> {
    return this.neo4j.executeWrite(async (transaction) => {
      const visible = await transaction.run(
        `MATCH (post:Post {id: $postId})
         MATCH (author:User {id: post.authorId})
         WHERE post.authorId = $userId OR EXISTS { MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author) }
         RETURN post.id AS id`,
        { postId: input.postId, userId: input.userId },
      );
      if (!visible.records.length) {
        const exists = await transaction.run('MATCH (post:Post {id: $postId}) RETURN post.id AS id', { postId: input.postId });
        return exists.records.length ? 'forbidden' : 'not-found';
      }
      const result = await transaction.run(
        `CREATE (media:PostMedia {
           id: $id, postId: $postId, ownerId: $userId, mediaType: $mediaType,
           mimeType: $mimeType, sizeBytes: $sizeBytes, originalName: $originalName,
           storageExtension: $storageExtension, createdAt: datetime($now)
         })
         RETURN media.id AS id, media.postId AS postId, media.mediaType AS mediaType,
                media.mimeType AS mimeType, media.sizeBytes AS sizeBytes,
                media.originalName AS originalName, toString(media.createdAt) AS createdAt`,
        input,
      );
      return readMedia(result.records[0]!, input.userId);
    });
  }

  async getMedia(id: string, userId: string): Promise<PostMedia | 'not-found' | 'forbidden'> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (media:PostMedia {id: $id})
         MATCH (post:Post {id: media.postId})
         MATCH (author:User {id: post.authorId})
         WHERE post.authorId = $userId OR EXISTS { MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author) }
         RETURN media.id AS id, media.postId AS postId, media.mediaType AS mediaType,
                media.mimeType AS mimeType, media.sizeBytes AS sizeBytes,
                media.originalName AS originalName, media.storageExtension AS storageExtension,
                toString(media.createdAt) AS createdAt`,
        { id, userId },
      );
      if (result.records[0]) return readMedia(result.records[0], userId);
      const exists = await transaction.run('MATCH (media:PostMedia {id: $id}) RETURN media.id AS id', { id });
      return exists.records.length ? 'forbidden' : 'not-found';
    });
  }

  async toggleLike(postId: string, userId: string, likeId: string, now: string, liked: boolean): Promise<boolean | 'not-found' | 'forbidden'> {
    return this.neo4j.executeWrite(async (transaction) => {
      const visible = await transaction.run(
        `MATCH (post:Post {id: $postId})
         MATCH (author:User {id: post.authorId})
         WHERE post.authorId = $userId OR EXISTS { MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author) }
         RETURN post.id AS id`,
        { postId, userId },
      );
      if (!visible.records.length) {
        const exists = await transaction.run('MATCH (post:Post {id: $postId}) RETURN post.id AS id', { postId });
        return exists.records.length ? 'forbidden' : 'not-found';
      }
      if (liked) {
        await transaction.run(
          `MATCH (user:User {id: $userId}), (post:Post {id: $postId})
           MERGE (user)-[:LIKED {id: $likeId, createdAt: datetime($now)}]->(post)`,
          { postId, userId, likeId, now },
        );
      } else {
        await transaction.run(
          `MATCH (user:User {id: $userId})-[like:LIKED]->(post:Post {id: $postId}) DELETE like`,
          { postId, userId },
        );
      }
      return liked;
    });
  }

  async toggleShare(postId: string, userId: string, shareId: string, now: string, shared: boolean): Promise<boolean | 'not-found' | 'forbidden'> {
    return this.neo4j.executeWrite(async (transaction) => {
      const visible = await transaction.run(
        `MATCH (post:Post {id: $postId})
         MATCH (author:User {id: post.authorId})
         WHERE post.authorId = $userId OR EXISTS { MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author) }
         RETURN post.id AS id`,
        { postId, userId },
      );
      if (!visible.records.length) {
        const exists = await transaction.run('MATCH (post:Post {id: $postId}) RETURN post.id AS id', { postId });
        return exists.records.length ? 'forbidden' : 'not-found';
      }
      if (shared) {
        await transaction.run(
          `MATCH (user:User {id: $userId}), (post:Post {id: $postId})
           MERGE (user)-[:SHARED {id: $shareId, createdAt: datetime($now)}]->(post)`,
          { postId, userId, shareId, now },
        );
      } else {
        await transaction.run(
          `MATCH (user:User {id: $userId})-[share:SHARED]->(post:Post {id: $postId}) DELETE share`,
          { postId, userId },
        );
      }
      return shared;
    });
  }

  async listComments(postId: string, userId: string): Promise<Comment[] | 'not-found' | 'forbidden'> {
    return this.neo4j.executeRead(async (transaction) => {
      const visible = await transaction.run(
        `MATCH (post:Post {id: $postId})
         MATCH (author:User {id: post.authorId})
         WHERE post.authorId = $userId OR EXISTS { MATCH (viewer:User {id: $userId})-[:FRIEND_WITH]-(author) }
         RETURN post.id AS id`,
        { postId, userId },
      );
      if (!visible.records.length) {
        const exists = await transaction.run('MATCH (post:Post {id: $postId}) RETURN post.id AS id', { postId });
        return exists.records.length ? 'forbidden' : 'not-found';
      }
      const result = await transaction.run(
        `MATCH (comment:Comment {postId: $postId})
         MATCH (author:User {id: comment.authorId})
         RETURN comment.id AS id, comment.postId AS postId, comment.content AS content,
                toString(comment.createdAt) AS createdAt, toString(comment.updatedAt) AS updatedAt,
                author.id AS authorId, author.displayName AS displayName
         ORDER BY comment.createdAt ASC, comment.id ASC`,
        { postId },
      );
      return result.records.map((record) => readComment(record, userId));
    });
  }

  async createComment(input: { id: string; postId: string; userId: string; content: string; now: string }): Promise<Comment | 'not-found' | 'forbidden'> {
    const visible = await this.listComments(input.postId, input.userId);
    if (visible === 'not-found' || visible === 'forbidden') return visible;
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (post:Post {id: $postId}), (author:User {id: $userId})
         CREATE (comment:Comment {id: $id, postId: $postId, authorId: $userId, content: $content,
           createdAt: datetime($now), updatedAt: datetime($now)})
         RETURN comment.id AS id, comment.postId AS postId, comment.content AS content,
                toString(comment.createdAt) AS createdAt, toString(comment.updatedAt) AS updatedAt,
                author.id AS authorId, author.displayName AS displayName`,
        input,
      );
      return readComment(result.records[0]!, input.userId);
    });
  }

  async removeComment(commentId: string, userId: string): Promise<'not-found' | 'forbidden' | 'deleted'> {
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (comment:Comment {id: $commentId})
         WITH comment, comment.authorId = $userId AS owned
         FOREACH (_ IN CASE WHEN owned THEN [1] ELSE [] END | DELETE comment)
         RETURN owned`,
        { commentId, userId },
      );
      if (!result.records.length) return 'not-found';
      return result.records[0]?.get('owned') ? 'deleted' : 'forbidden';
    });
  }
}

function readPost(record: { get(key: string): unknown }, userId: string): Post {
  const authorId = String(record.get('authorId'));
  return {
    id: String(record.get('id')),
    content: String(record.get('content')),
    createdAt: String(record.get('createdAt')),
    updatedAt: String(record.get('updatedAt')),
    author: { id: authorId, displayName: String(record.get('displayName')) },
    mine: authorId === userId,
    likeCount: asNumber(record.get('likeCount')),
    commentCount: asNumber(record.get('commentCount')),
    shareCount: asNumber(record.get('shareCount')),
    likedByMe: record.get('likedByMe') === true,
    sharedByMe: record.get('sharedByMe') === true,
    media: readMediaList(record.get('media')),
  };
}

function readMediaList(value: unknown): PostMedia[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const media = item as Record<string, unknown>;
    return {
      id: String(media.id),
      postId: String(media.postId),
      mediaType: media.mediaType === 'video' ? 'video' : 'image',
      mimeType: String(media.mimeType),
      sizeBytes: asNumber(media.sizeBytes),
      originalName: String(media.originalName),
      createdAt: String(media.createdAt),
      url: String(media.url),
    };
  });
}

function readComment(record: { get(key: string): unknown }, userId: string): Comment {
  const authorId = String(record.get('authorId'));
  return {
    id: String(record.get('id')),
    postId: String(record.get('postId')),
    content: String(record.get('content')),
    createdAt: String(record.get('createdAt')),
    updatedAt: String(record.get('updatedAt')),
    author: { id: authorId, displayName: String(record.get('displayName')) },
    mine: authorId === userId,
  };
}

function readMedia(record: { get(key: string): unknown }, _userId: string): PostMedia {
  return {
    id: String(record.get('id')),
    postId: String(record.get('postId')),
    mediaType: record.get('mediaType') === 'video' ? 'video' : 'image',
    mimeType: String(record.get('mimeType')),
    sizeBytes: asNumber(record.get('sizeBytes')),
    originalName: String(record.get('originalName')),
    createdAt: String(record.get('createdAt')),
    url: `/posts/media/${String(record.get('id'))}`,
  };
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return 0;
}
