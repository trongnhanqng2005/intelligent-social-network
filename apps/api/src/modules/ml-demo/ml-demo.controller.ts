import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { MlDemoService } from './ml-demo.service.js';

export class ReviewAlertDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  snapshotId!: string;

  @IsString()
  @Matches(/^synthetic-test-actor-\d{3}$/)
  actorId!: string;
}

@Controller('ml-demo')
@UseGuards(AuthSessionGuard, AdminGuard)
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

  @Put('anomalies/review')
  @Header('Cache-Control', 'no-store')
  review(@CurrentUser() user: AuthPrincipal, @Body() body: ReviewAlertDto) {
    return this.demo.review(user, body.snapshotId, body.actorId);
  }
}
