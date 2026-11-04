import { Injectable } from '@nestjs/common';
import { int, type Transaction } from 'neo4j-driver';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import { canonicalizeFriendshipPair } from '../friendships/friendship-pair.js';
import { PostActionOutcomeError, PostGraphInvariantError } from './posts.errors.js';
import type { PostsCursor } from './post-pagination.js';
import type { PostComment, PostVisibility, StoredPost } from './posts.types.js';

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
  WITH DISTINCT viewer, authorId, isOwner
  MATCH (author:User)
  WHERE author.id = authorId
       WITH DISTINCT viewer, author, isOwner
       CALL (author, isOwner, viewer) {
        MATCH (post:Post)
        USING INDEX post:Post(authorId, createdAt, id)
          WHERE post.authorId IN [author.id] AND post.createdAt IS NOT NULL AND post.id IS NOT NULL AND
                post.visibility IN ['members', 'friends']
        MATCH (author)-[authored:AUTHORED]->(post)
         WITH author, isOwner, viewer, post, count(authored) AS authorLinks
    WHERE post.visibility IN ['members', 'friends'] AND
          (isOwner OR post.visibility = 'members' OR post.visibility = 'friends') AND
          ($cursorCreatedAt IS NULL OR post.createdAt < datetime($cursorCreatedAt) OR
           (post.createdAt = datetime($cursorCreatedAt) AND post.id < $cursorId))
        CALL (post) {
         MATCH (:User)-[owned:AUTHORED]->(post)
       RETURN count(owned) AS authorCount
     }
        WITH post, author, viewer, isOwner, authorLinks, authorCount, post.createdAt AS sortCreatedAt, post.id AS id
        ORDER BY sortCreatedAt DESC, id DESC LIMIT $perAuthorLimit
        CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
        CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
        CALL (viewer, post) { OPTIONAL MATCH (viewer)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
        RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
             post.visibility AS visibility, sortCreatedAt,
            post.updatedAt AS sortUpdatedAt, post.version AS version,
            author.displayName AS displayName, author.bio AS bio, author.location AS location,
             authorLinks, authorCount, likeCount, commentCount, likedByViewer
   }
   WITH id, authorId, content, visibility, sortCreatedAt, sortUpdatedAt, version,
         displayName, bio, location, authorLinks, authorCount, likeCount, commentCount, likedByViewer
   ORDER BY sortCreatedAt DESC, id DESC LIMIT $fetchLimit
   RETURN id, authorId, content, visibility, toString(sortCreatedAt) AS createdAt,
          toString(sortUpdatedAt) AS updatedAt, version,
           displayName, bio, location, authorLinks, authorCount, likeCount, commentCount, likedByViewer
`;

@Injectable()
export class PostsRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async setLike(viewerId: string, postId: string, liked: boolean): Promise<{ liked: boolean }> {
    return this.executeInteractionWrite(async (tx) => {
      await lockVisiblePostForAction(tx, viewerId, postId);
       const result = await tx.run(liked
        ? `MATCH (viewer:User {id:$viewerId}), (author:User)-[:AUTHORED]->(post:Post {id:$postId}) WHERE post.authorId = author.id AND (viewer.id = author.id OR post.visibility = 'members' OR (post.visibility = 'friends' AND ${canonicalFriendship})) MERGE (viewer)-[:LIKED]->(post) RETURN count(*) AS changed`
        : `MATCH (viewer:User {id:$viewerId})-[like:LIKED]->(:Post {id:$postId}) DELETE like RETURN count(like) AS changed`, { viewerId, postId });
       return { liked: liked ? result.records.length >= 0 : false };
    });
  }

  async listComments(viewerId: string, postId: string, cursor: { createdAt: string; id: string } | undefined, limit: number): Promise<PostComment[]> {
    return this.neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `MATCH (viewer:User {id: $viewerId})
          OPTIONAL MATCH (author:User)-[:AUTHORED]->(post:Post {id: $postId})
          WITH viewer, author, post
          WHERE author IS NOT NULL AND post.authorId = author.id AND
               (viewer.id = author.id OR post.visibility = 'members' OR
                (post.visibility = 'friends' AND ${canonicalFriendship}))
          OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post)
          WHERE comment.deleted = false AND
                ($cursorCreatedAt IS NULL OR comment.createdAt < datetime($cursorCreatedAt) OR
                 (comment.createdAt = datetime($cursorCreatedAt) AND comment.id < $cursorId))
          OPTIONAL MATCH (commentAuthor:User)-[:WROTE_COMMENT]->(comment)
          RETURN post.id AS visiblePostId, comment.id AS id, comment.clientId AS clientId, comment.content AS content,
                toString(comment.createdAt) AS createdAt, toString(comment.updatedAt) AS updatedAt,
                comment.version AS version, commentAuthor.id AS authorId,
                commentAuthor.displayName AS displayName
         ORDER BY comment.createdAt DESC, comment.id DESC LIMIT $limit`,
        { viewerId, postId, cursorCreatedAt: cursor?.createdAt ?? null,
          cursorId: cursor?.id ?? null, limit: int(limit) },
      );
       if (!result.records[0]?.get('visiblePostId')) throw new PostActionOutcomeError('not-found');
       return result.records.filter((r) => r.get('id') !== null).map((r) => ({
        id: String(r.get('id')), clientId: String(r.get('clientId')), postId,
        content: String(r.get('content')), deleted: false,
        createdAt: String(r.get('createdAt')), updatedAt: String(r.get('updatedAt')),
        version: numberValue(r.get('version')),
        author: { id: String(r.get('authorId')), displayName: String(r.get('displayName')) },
        permissions: { canEdit: String(r.get('authorId')) === viewerId,
          canDelete: String(r.get('authorId')) === viewerId },
      }));
    });
  }

  async createComment(viewerId: string, postId: string, input: {clientId:string;content:string}) {
    const now = new Date().toISOString();
    return this.executeInteractionWrite(async (tx) => {
      await lockVisiblePostForAction(tx, viewerId, postId);
        const key = createHash('sha256').update(`${postId}:${viewerId}:${input.clientId}`).digest('hex');
        const contentHash = createHash('sha256').update(input.content).digest('hex');
       const result = await tx.run(`MATCH (viewer:User {id:$viewerId}), (author:User)-[:AUTHORED]->(post:Post {id:$postId}) WHERE post.authorId = author.id AND (viewer.id = author.id OR post.visibility = 'members' OR (post.visibility = 'friends' AND ${canonicalFriendship})) MERGE (comment:Comment {retryKey:$key}) ON CREATE SET comment.id=$id, comment.clientId=$clientId, comment.postId=$postId, comment.content=$content, comment.originalContentHash=$contentHash, comment.createdAt=datetime($now), comment.updatedAt=datetime($now), comment.version=0, comment.deleted=false MERGE (comment)-[:ON_POST]->(post) MERGE (viewer)-[:WROTE_COMMENT]->(comment) RETURN comment.id AS id, comment.clientId AS clientId, comment.content AS content, comment.deleted AS deleted, comment.originalContentHash AS originalContentHash, toString(comment.createdAt) AS createdAt, toString(comment.updatedAt) AS updatedAt, comment.version AS version, viewer.id AS authorId, viewer.displayName AS displayName`, {viewerId,postId,key,id:randomUUID(),clientId:input.clientId,content:input.content,contentHash,now});
       const record = result.records[0];
        if (!record) throw new PostActionOutcomeError('not-found');
        if (record.get('deleted') === true || record.get('clientId') !== input.clientId || record.get('originalContentHash') !== contentHash) throw new PostActionOutcomeError('conflict');
        return mapComment(record, postId, viewerId);
    });
  }

  async updateComment(viewerId:string, postId:string, commentId:string, content:string, expectedVersion:number) {
    return this.executeInteractionWrite(async (tx) => {
      await lockVisiblePostForAction(tx, viewerId, postId);
      const status = await commentMutationStatus(tx, viewerId, postId, commentId, expectedVersion);
      if (status) throw new PostActionOutcomeError(status);
      const result = await tx.run(
        `MATCH (viewer:User {id:$viewerId})-[:WROTE_COMMENT]->(comment:Comment {id:$commentId})-[:ON_POST]->(post:Post {id:$postId}) MATCH (author:User)-[:AUTHORED]->(post) WHERE post.authorId=author.id AND (viewer.id=author.id OR post.visibility='members' OR (post.visibility='friends' AND ${canonicalFriendship})) AND comment.deleted=false AND comment.version=$expectedVersion SET comment.content=$content, comment.updatedAt=datetime(), comment.version=comment.version+1 RETURN comment.id AS id, comment.clientId AS clientId, comment.content AS content, comment.deleted AS deleted, toString(comment.createdAt) AS createdAt, toString(comment.updatedAt) AS updatedAt, comment.version AS version, viewer.id AS authorId, viewer.displayName AS displayName`,
        { viewerId, postId, commentId, content, expectedVersion },
      );
      if (result.records.length !== 1) throw new PostActionOutcomeError('conflict');
      return mapComment(result.records[0]!, postId, viewerId);
    });
  }

  async deleteComment(viewerId:string, postId:string, commentId:string, expectedVersion:number) {
    return this.executeInteractionWrite(async (tx) => {
      await lockVisiblePostForAction(tx, viewerId, postId);
      const status = await commentMutationStatus(tx, viewerId, postId, commentId, expectedVersion);
      if (status) throw new PostActionOutcomeError(status);
      const result = await tx.run(
        `MATCH (viewer:User {id:$viewerId})-[:WROTE_COMMENT]->(comment:Comment {id:$commentId})-[:ON_POST]->(post:Post {id:$postId}) MATCH (author:User)-[:AUTHORED]->(post) WHERE post.authorId=author.id AND (viewer.id=author.id OR post.visibility='members' OR (post.visibility='friends' AND ${canonicalFriendship})) AND comment.version=$expectedVersion AND comment.deleted=false SET comment.deleted=true, comment.content='', comment.updatedAt=datetime(), comment.version=comment.version+1 RETURN count(comment) AS changed`,
        { viewerId, postId, commentId, expectedVersion },
      );
      if (result.records.length !== 1 || numberValue(result.records[0]?.get('changed')) !== 1) {
        throw new PostActionOutcomeError('conflict');
      }
    });
  }

  private async executeInteractionWrite<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.neo4j.executeWriteOnce(work);
    } catch (error) {
      if (!isPostWriteDeadlock(error)) throw error;
    }
    await delay(50);
    try {
      return await this.neo4j.executeWriteOnce(work);
    } catch (error) {
      if (isPostWriteDeadlock(error)) throw new PostActionOutcomeError('conflict');
      throw error;
    }
  }

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
          CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
          CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
          CALL (author, post) { OPTIONAL MATCH (author)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
          OPTIONAL MATCH (post)-[relationship]-()
         RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                 authorLinks, authorLinks AS authorCount, likeCount, commentCount, likedByViewer,
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
    CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
       CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
       CALL (viewer, post) { OPTIONAL MATCH (viewer)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
      RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                 authorLinks, authorCount, likeCount, commentCount, likedByViewer`,
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
          CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
          CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
          CALL (viewer, post) { OPTIONAL MATCH (viewer)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
          RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                toString(post.updatedAt) AS updatedAt, post.version AS version,
                author.displayName AS displayName, author.bio AS bio, author.location AS location,
                 authorLinks, authorCount, likeCount, commentCount, likedByViewer
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
            CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
            CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
             CALL (author, post) { OPTIONAL MATCH (author)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
      RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
                  post.visibility AS visibility, toString(post.createdAt) AS createdAt,
                  toString(post.updatedAt) AS updatedAt, post.version AS version,
                  author.displayName AS displayName, author.bio AS bio, author.location AS location,
                   1 AS authorLinks, authorCount, likeCount, commentCount, likedByViewer`,
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
        const result = await transaction.run(
          `MATCH (author:User {id: $viewerId})-[authored:AUTHORED]->(post:Post {
             id: $postId, authorId: $viewerId
           })
             WHERE post.version = $expectedVersion
             OPTIONAL MATCH (comment:Comment)-[onPost:ON_POST]->(post)
             OPTIONAL MATCH (:User)-[written:WROTE_COMMENT]->(comment)
             WITH authored,post,collect(DISTINCT comment) AS comments,collect(DISTINCT onPost) AS postEdges,collect(DISTINCT written) AS writtenEdges
             OPTIONAL MATCH (viewer:User)-[like:LIKED]->(post)
            WITH authored, post, comments, postEdges, writtenEdges, collect(DISTINCT like) AS likes
            FOREACH (relationship IN likes | DELETE relationship)
            FOREACH (relationship IN postEdges | DELETE relationship)
            FOREACH (relationship IN writtenEdges | DELETE relationship)
            FOREACH (comment IN comments | DELETE comment)
           DELETE authored, post
           RETURN 1 AS deleted`,
          input,
        );
        return result.records.length === 1 ? 'deleted' : 'conflict';
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
     SET post.version = post.version + 1
     WITH post
     SET post.version = post.version - 1
     RETURN post.id AS id, post.version AS version`,
    { postId },
  );
  return result.records.length === 1;
}

async function lockExistingFriendshipPair(transaction: Transaction, viewerId: string, authorId: string): Promise<void> {
  const canonical = canonicalizeFriendshipPair(viewerId, authorId);
  if (!canonical) return;
  await transaction.run(
    `MATCH (pair:FriendshipPair {pairKey: $pairKey})
     SET pair.version = pair.version + 1
     WITH pair
     SET pair.version = pair.version - 1
     RETURN pair.pairKey AS pairKey, pair.version AS version`,
    { pairKey: canonical.pairKey },
  );
}

async function lockVisiblePostForAction(
  transaction: Transaction,
  viewerId: string,
  postId: string,
): Promise<StoredPost> {
  await lockPost(transaction, postId);
  let visible = await findVisibleInTransaction(transaction, viewerId, postId);
  if (!visible) throw new PostActionOutcomeError('not-found');
  if (visible.visibility === 'friends' && visible.authorId !== viewerId) {
    await lockExistingFriendshipPair(transaction, viewerId, visible.authorId);
    visible = await findVisibleInTransaction(transaction, viewerId, postId);
    if (!visible) throw new PostActionOutcomeError('not-found');
  }
  return visible;
}

async function commentMutationStatus(
  transaction: Transaction, viewerId: string, postId: string, commentId: string, expectedVersion: number,
): Promise<'not-found' | 'forbidden' | 'conflict' | undefined> {
  const result = await transaction.run(
    `MATCH (comment:Comment {id:$commentId})-[:ON_POST]->(:Post {id:$postId})
     OPTIONAL MATCH (author:User)-[:WROTE_COMMENT]->(comment)
     RETURN comment.version AS version, comment.deleted AS deleted, author.id AS authorId`,
    { commentId, postId },
  );
  const record = result.records[0];
  if (!record) return 'not-found';
  if (record.get('authorId') !== viewerId) return 'forbidden';
  if (record.get('deleted') === true || asNumber(record.get('version')) !== expectedVersion) return 'conflict';
  return undefined;
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
      CALL (post) { OPTIONAL MATCH (:User)-[like:LIKED]->(post) RETURN count(like) AS likeCount }
      CALL (post) { OPTIONAL MATCH (comment:Comment)-[:ON_POST]->(post) WHERE comment.deleted = false RETURN count(comment) AS commentCount }
      CALL (viewer, post) { OPTIONAL MATCH (viewer)-[viewerLike:LIKED]->(post) RETURN count(viewerLike) > 0 AS likedByViewer }
      RETURN post.id AS id, post.authorId AS authorId, post.content AS content,
            post.visibility AS visibility, toString(post.createdAt) AS createdAt,
            toString(post.updatedAt) AS updatedAt, post.version AS version,
            author.displayName AS displayName, author.bio AS bio, author.location AS location,
              authorLinks, authorCount, likeCount, commentCount, likedByViewer${includeRelationshipCount ? ', relationshipCount' : ''}`,
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
    likeCount: record.keys?.includes('likeCount') ? asNumber(record.get('likeCount')) : 0,
    commentCount: record.keys?.includes('commentCount') ? asNumber(record.get('commentCount')) : 0,
    likedByViewer: record.keys?.includes('likedByViewer') ? record.get('likedByViewer') === true : false,
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

function numberValue(value: unknown): number { return asNumber(value); }

function mapComment(record: {get(key:string):unknown}, postId:string, viewerId:string): {comment:PostComment} {
  const authorId=String(record.get('authorId'));
  return {comment:{id:String(record.get('id')),clientId:String(record.get('clientId')),postId,content:String(record.get('content')),deleted:Boolean(record.get('deleted')),createdAt:String(record.get('createdAt')),updatedAt:String(record.get('updatedAt')),version:numberValue(record.get('version')),author:{id:authorId,displayName:String(record.get('displayName'))},permissions:{canEdit:authorId===viewerId,canDelete:authorId===viewerId}}};
}
