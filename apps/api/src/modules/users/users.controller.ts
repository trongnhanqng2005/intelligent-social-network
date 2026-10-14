import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { UpdateOwnProfileDto, UserIdParamsDto, UsersQueryDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(AuthSessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/profile')
  @Header('Cache-Control', 'no-store')
  getOwnProfile(@CurrentUser() user: AuthPrincipal) {
    return this.users.getOwnProfile(user.id);
  }

  @Patch('me/profile')
  @Header('Cache-Control', 'no-store')
  updateOwnProfile(@CurrentUser() user: AuthPrincipal, @Body() body: UpdateOwnProfileDto) {
    return this.users.updateOwnProfile(user.id, body);
  }

  @Get(':id/profile')
  @Header('Cache-Control', 'no-store')
  getMemberProfile(@CurrentUser() user: AuthPrincipal, @Param() params: UserIdParamsDto) {
    return this.users.getMemberProfile(user.id, params.id);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  listMembers(@CurrentUser() user: AuthPrincipal, @Query() query: UsersQueryDto) {
    return this.users.listMembers(user.id, query);
  }
}
