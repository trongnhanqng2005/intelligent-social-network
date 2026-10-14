# NestJS API

## Implemented structure

```text
apps/api/src/
├── main.ts                    # Nest bootstrap, validated host/port, shutdown hooks
├── app.module.ts              # Root composition
├── config/env.validation.ts   # API and Neo4j configuration validation
├── neo4j/                     # App-scoped driver, explicit sessions, V1–V3 migrations and readiness
└── modules/
    ├── health/                # GET /health and GET /ready
    └── auth/                  # Registration, login, durable sessions, CSRF/origin defense
    └── users/                 # Authenticated profile, edit, member lookup and directory
```

`AppModule` imports global validated configuration, `HealthModule`, `AuthModule` and `UsersModule`. `GET /health` remains dependency-independent liveness. `GET /ready` checks driver connectivity, explicit database identity, migration history and V3 schema/index readiness. `Neo4jModule` owns the application-scoped driver and managed transaction helpers. Authentication persists account/session/event changes transactionally, uses Argon2id, RS256 and HttpOnly cookies, and checks every session against Neo4j. Users extends the existing `User` node, derives ownership only from the authenticated principal, and returns explicit own/public projections. CSRF and exact-origin validation cover unsafe HTTP requests. See the [API contracts](../api/README.md) for wire behavior. There is no global `/api` prefix; the `/api` browser path is development-proxy routing only.

Configuration accepts `NODE_ENV` values `development`, `test`, `production`; `PORT` must be an integer 1–65535; `HOST` and Neo4j connection settings must be non-empty/valid. Development is pinned to `isn-dev`; test mode requires `isn-test` and separate test credentials. Defaults remain port 3000 and loopback `127.0.0.1`. Tests are API-local Jest; HTTP contracts use API-local Supertest E2E. See [Neo4j operations](../development/neo4j-operations.md) for schema and environment procedures.

## Extension guidance

Add a Nest feature module when a real domain responsibility is approved. Keep controller boundary concerns separate from application behavior; introduce providers, persistence adapters, DTO validation and shared technical modules only when required by actual behavior. Define cross-module dependency direction and transaction boundaries as the domain grows; the implemented health/auth foundation does not establish future social-domain decisions.

Posts/interactions, friendships, recommendations, account recovery, production routing/deployment, distributed abuse protection and production event retention are not implemented or decided. Activity-event pruning is intentionally absent pending data-governance approval.
