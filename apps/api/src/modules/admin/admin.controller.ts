import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AuthSessionGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('anomalies')
  @Header('Cache-Control', 'no-store')
  anomalies(@CurrentUser() user: AuthPrincipal) {
    return this.admin.listAnomalies(user);
  }
}
