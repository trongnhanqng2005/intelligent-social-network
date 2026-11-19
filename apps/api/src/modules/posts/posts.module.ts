import { Module } from '@nestjs/common';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FeedController } from './feed.controller.js';
import { PostsController } from './posts.controller.js';
import { PostsRepository } from './posts.repository.js';
import { PostsService } from './posts.service.js';
import { ProfilePostsController } from './profile-posts.controller.js';

@Module({
  imports: [AuthModule, Neo4jModule],
  controllers: [PostsController, ProfilePostsController, FeedController],
  providers: [PostsRepository, PostsService],
})
export class PostsModule {}
