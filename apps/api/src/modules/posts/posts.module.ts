import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { PostsController } from './posts.controller.js';
import { PostsRepository } from './posts.repository.js';
import { PostsService } from './posts.service.js';

@Module({
  imports: [AuthModule, Neo4jModule],
  controllers: [PostsController],
  providers: [PostsRepository, PostsService],
})
export class PostsModule {}
