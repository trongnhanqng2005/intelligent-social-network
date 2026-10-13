import 'reflect-metadata';

async function run(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'apply' && mode !== 'status') {
    throw new Error('Usage: migrate.js apply|status');
  }
  process.env.NODE_ENV ??= 'development';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module.js');
  const { Neo4jMigrationService } = await import('./neo4j-migrations.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const migrations = app.get(Neo4jMigrationService);
    const result = mode === 'apply' ? await migrations.migrate() : await migrations.getStatus();
    console.log(JSON.stringify(result));
    if (mode === 'status' && result.status !== 'current') process.exitCode = 1;
  } catch {
    console.error('Neo4j migration command failed. Inspect target identity, migration history, and schema definitions; no automatic rollback is performed.');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void run();
