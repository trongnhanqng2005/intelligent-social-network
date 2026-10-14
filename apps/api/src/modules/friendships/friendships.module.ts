import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { FriendshipsController } from './friendships.controller.js';
import { FriendshipsRepository } from './friendships.repository.js';
import { FriendshipsService } from './friendships.service.js';

@Module({
  imports: [AuthModule, Neo4jModule],
  controllers: [FriendshipsController],
  providers: [FriendshipsRepository, FriendshipsService],
})
export class FriendshipsModule {}
