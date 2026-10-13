import { Module } from '@nestjs/common';
import { Neo4jModule } from '../../neo4j/neo4j.module.js';
import { HealthController } from './health.controller.js';
import { ReadinessController } from './readiness.controller.js';

@Module({
  imports: [Neo4jModule],
  controllers: [HealthController, ReadinessController],
})
export class HealthModule {}
