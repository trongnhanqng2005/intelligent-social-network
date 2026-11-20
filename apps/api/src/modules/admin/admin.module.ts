import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { noStore } from '../ml-demo/ml-demo.module.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, Neo4jModule],
  controllers: [AdminController],
  providers: [AdminRepository, AdminService],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(noStore).forRoutes({ path: 'admin/anomalies', method: RequestMethod.GET });
  }
}
