import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, Neo4jModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
})
export class UsersModule {}
