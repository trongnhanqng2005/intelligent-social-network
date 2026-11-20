import { dirname, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { FriendshipsModule } from './modules/friendships/friendships.module.js';
import { PostsModule } from './modules/posts/posts.module.js';
import { MlDemoModule } from './modules/ml-demo/ml-demo.module.js';
import { AdminModule } from './modules/admin/admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      envFilePath: process.env.ISN_API_ENV_FILE ?? '.env',
      validate: (raw: Record<string, unknown>) => {
        const config = validateEnvironment(raw);
        const envFile = process.env.ISN_API_ENV_FILE;
        if (!envFile) return config;
        const base = dirname(resolve(envFile));
        return {
          ...config,
          AUTH_PRIVATE_KEY_PATH: resolve(base, config.AUTH_PRIVATE_KEY_PATH),
          AUTH_PUBLIC_KEY_PATH: resolve(base, config.AUTH_PUBLIC_KEY_PATH),
          AUTH_CSRF_SECRET_PATH: resolve(base, config.AUTH_CSRF_SECRET_PATH),
        };
      },
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    FriendshipsModule,
    PostsModule,
    MlDemoModule,
    AdminModule,
  ],
})
export class AppModule {}
