# NestJS API

## Implemented structure

```text
apps/api/src/
├── main.ts                    # Nest bootstrap, validated host/port, shutdown hooks
├── app.module.ts              # Root composition
├── config/env.validation.ts   # API and Neo4j configuration validation
├── neo4j/                     # App-scoped driver, explicit sessions, schema and readiness
└── modules/health/
    ├── health.module.ts
    ├── health.controller.ts   # GET /health -> { status: "ok" }
    └── readiness.controller.ts # GET /ready -> database/schema readiness
```

`AppModule` imports global `ConfigModule` and `HealthModule`. `GET /health` returns exactly `{ "status": "ok" }`, with HTTP 200 and JSON content type; it remains process liveness and does not check Neo4j. `GET /ready` checks driver connectivity, confirms the explicitly selected database identity and validates the foundation schema marker/constraint; it returns 503 with a sanitized reason when unavailable or out of date. `Neo4jModule` owns one application-scoped official driver, closes it on shutdown, selects the configured database for every session, and exposes managed read/write transaction helpers. The only initial schema is a uniqueness constraint and a version marker; initialization is explicit and repeatable, never a reset or seed. There is no global `/api` prefix, business service, repository, common layer or general-purpose infrastructure layer.

Configuration accepts `NODE_ENV` values `development`, `test`, `production`; `PORT` must be an integer 1–65535; `HOST` and Neo4j connection settings must be non-empty/valid. Development is pinned to `isn-dev`; test mode requires `isn-test` and separate test credentials. Defaults remain port 3000 and loopback `127.0.0.1`. Tests are API-local Jest; HTTP contracts use API-local Supertest E2E. See [Neo4j operations](../development/neo4j-operations.md) for schema and environment procedures.

## Extension guidance

Add a Nest feature module when a real domain responsibility is approved. Keep controller boundary concerns separate from application behavior; introduce providers, persistence adapters, DTO validation and shared technical modules only when required by actual behavior. Define cross-module dependency direction and transaction boundaries as the domain grows; the current health-only app does not establish those future decisions.

No authentication, authorization, persistence, security-header policy or production deployment is currently implemented.
