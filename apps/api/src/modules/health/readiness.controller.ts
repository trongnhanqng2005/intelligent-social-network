import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Neo4jSchemaService } from '../../neo4j/neo4j-schema.service.js';

@Controller('ready')
export class ReadinessController {
  constructor(private readonly schemaService: Neo4jSchemaService) {}

  @Get()
  async checkReadiness(
    @Res({ passthrough: true }) response: {
      status: (statusCode: number) => unknown;
    },
  ): Promise<Awaited<ReturnType<Neo4jSchemaService['checkReadiness']>>> {
    const readiness = await this.schemaService.checkReadiness();
    if (readiness.status !== 'ready') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
