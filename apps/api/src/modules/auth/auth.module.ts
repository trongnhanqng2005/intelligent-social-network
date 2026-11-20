import { Module } from '@nestjs/common';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthSecurityService } from './auth-security.service.js';
import { AuthService } from './auth.service.js';
import { AuthSessionGuard } from './auth-session.guard.js';
import { JwtService } from './jwt.service.js';
import { PasswordService } from './password.service.js';
import { AdminGuard } from './admin.guard.js';

@Module({
  imports: [Neo4jModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthSecurityService, AuthService, AuthSessionGuard, AdminGuard, JwtService, PasswordService],
  exports: [AuthService, AuthSecurityService, AuthSessionGuard, AdminGuard],
})
export class AuthModule {}
