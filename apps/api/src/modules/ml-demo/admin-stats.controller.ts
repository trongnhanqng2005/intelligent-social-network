import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthSessionGuard } from '../auth/auth-session.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { Neo4jService } from '../../neo4j/neo4j.service.js';

@Controller('admin')
@UseGuards(AuthSessionGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly neo4j: Neo4jService) {}

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  async stats() {
    return this.neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `CALL { MATCH (n:User) RETURN count(n) AS users }
         CALL { MATCH ()-[r:FRIEND_WITH]->() RETURN count(r) AS friendships }
         CALL { MATCH (n:Post) RETURN count(n) AS posts }
         CALL { MATCH (n:Comment {deleted: false}) RETURN count(n) AS comments }
         RETURN users, friendships, posts, comments`,
      );
      const row = result.records[0]!;
      const number = (value: unknown) => typeof value === 'number' ? value : (value as { toNumber(): number }).toNumber();
      return { users: number(row.get('users')), friendships: number(row.get('friendships')), posts: number(row.get('posts')), comments: number(row.get('comments')) };
    });
  }
}
