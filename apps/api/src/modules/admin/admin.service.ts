import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { int } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';

type ListInput = { q?: string; state?: string; offset?: number; limit?: number };

@Injectable()
export class AdminService {
  constructor(private readonly neo4j: Neo4jService) {}

  members(input: ListInput) {
    return this.neo4j.executeRead(async tx => {
      const result = await tx.run(
        `MATCH (user:User)
         WITH user, coalesce(user.accountLocked, false) AS locked
         WHERE ($q = '' OR toLower(user.email) CONTAINS $q OR toLower(user.displayName) CONTAINS $q)
           AND ($state = 'all' OR ($state = 'locked' AND locked) OR ($state = 'active' AND NOT locked))
         RETURN user.id AS id, user.email AS email, user.displayName AS displayName,
                coalesce(user.role, 'USER') AS role, locked
         ORDER BY user.id SKIP $offset LIMIT $limit`,
        params(input, input.state ?? 'all'),
      );
      return { items: result.records.map(row => ({
        id: String(row.get('id')), email: String(row.get('email')), displayName: String(row.get('displayName')),
        role: row.get('role') === 'ADMIN' ? 'ADMIN' : 'USER', locked: row.get('locked') === true,
      })) };
    });
  }

  posts(input: ListInput) {
    return this.contentList(input);
  }

  comments(input: ListInput) {
    return this.contentList(input, true);
  }

  private contentList(input: ListInput, comment = false) {
    const authorRelationship = comment
      ? '(author:User)-[:WROTE_COMMENT]->(item:Comment)'
      : '(author:User)-[:AUTHORED]->(item:Post)';
    const deletedPredicate = comment ? 'AND coalesce(item.deleted, false) = false' : '';
    return this.neo4j.executeRead(async tx => {
      const result = await tx.run(
        `MATCH ${authorRelationship}
         WITH item, author, coalesce(item.adminHidden, false) AS hidden
         WHERE ($q = '' OR toLower(item.content) CONTAINS $q OR toLower(author.displayName) CONTAINS $q)
           AND ($state = 'all' OR ($state = 'hidden' AND hidden) OR ($state = 'visible' AND NOT hidden))
           ${deletedPredicate}
         RETURN item.id AS id, author.id AS authorId, author.displayName AS authorName,
                item.content AS content, toString(item.createdAt) AS createdAt, hidden,
                item.postId AS postId
         ORDER BY item.id SKIP $offset LIMIT $limit`,
        params(input, input.state ?? 'all'),
      );
      return { items: result.records.map(row => ({
        id: String(row.get('id')), authorId: String(row.get('authorId')), authorName: String(row.get('authorName')),
        content: String(row.get('content')), createdAt: String(row.get('createdAt')), hidden: row.get('hidden') === true,
        ...(comment ? { postId: String(row.get('postId')) } : {}),
      })) };
    });
  }

  async lockMember(actorId: string, id: string, locked: boolean) {
    const result = await this.neo4j.executeWrite(async tx => tx.run(
      `MATCH (admin:User {id:$actorId})
       WHERE admin.role = 'ADMIN' AND coalesce(admin.accountLocked, false) = false
       MATCH (user:User {id:$id})
       SET user.accountLocked = CASE WHEN coalesce(user.role, 'USER') = 'ADMIN' AND $locked
                                     THEN user.accountLocked
                                     ELSE CASE WHEN $locked THEN true ELSE null END END
       RETURN user.id AS id, coalesce(user.role, 'USER') AS role,
              coalesce(user.accountLocked, false) AS locked`,
      { actorId, id, locked },
    ));
    if (!result.records.length) throw new NotFoundException();
    const row = result.records[0]!;
    if (locked && row.get('role') === 'ADMIN') throw new ForbiddenException();
    return { id, locked: row.get('locked') === true };
  }

  async setPostVisibility(actorId: string, id: string, hidden: boolean) {
    return this.setVisibility(actorId, id, 'Post', hidden);
  }

  async setCommentVisibility(actorId: string, id: string, hidden: boolean) {
    return this.setVisibility(actorId, id, 'Comment', hidden);
  }

  private async setVisibility(actorId: string, id: string, label: 'Post' | 'Comment', hidden: boolean) {
    const commentFilter = label === 'Comment' ? 'WHERE coalesce(item.deleted, false) = false' : '';
    const result = await this.neo4j.executeWrite(async tx => tx.run(
      `MATCH (admin:User {id:$actorId})
       WHERE admin.role = 'ADMIN' AND coalesce(admin.accountLocked, false) = false
       MATCH (item:${label} {id:$id})
       ${commentFilter}
       SET item.adminHidden = CASE WHEN $hidden THEN true ELSE null END
       RETURN item.id AS id`,
      { actorId, id, hidden },
    ));
    if (!result.records.length) throw new NotFoundException();
    return { id, hidden };
  }
}

function params(input: ListInput, state: string) {
  return {
    q: (input.q ?? '').trim().toLowerCase(), state,
    offset: int(input.offset ?? 0), limit: int(input.limit ?? 50),
  };
}
