import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { MlDemoService } from './ml-demo.service.js';

@Controller('ml-demo')
@UseGuards(AuthSessionGuard)
export class MlDemoController {
  constructor(private readonly demo: MlDemoService) {}

  @Get('recommendations')
  @Header('Cache-Control', 'no-store')
  recommendations(@CurrentUser() user: AuthPrincipal) {
    return this.demo.recommendations(user);
  }

  @Get('anomalies')
  @Header('Cache-Control', 'no-store')
  anomalies(@CurrentUser() user: AuthPrincipal) {
    return this.demo.anomalies(user);
  }
}
