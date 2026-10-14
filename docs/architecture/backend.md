# NestJS API

## Implemented structure

```text
apps/api/src/
├── main.ts                    # Nest bootstrap, validated host/port, shutdown hooks
├── app.module.ts              # Root composition
├── config/env.validation.ts   # API and Neo4j configuration validation
├── neo4j/                     # App-scoped driver, explicit sessions, V1–V4 migration definitions and readiness
└── modules/
    ├── health/                # GET /health and GET /ready
    ├── auth/                  # Registration, login, durable sessions, CSRF/origin defense
    ├── users/                 # Authenticated profile, edit, member lookup and directory
    └── friendships/           # Caller-owned requests/friends, pair state machine and canonical graph
```

`AppModule` imports global validated configuration, `HealthModule`, `AuthModule`, `UsersModule`, and `FriendshipsModule`. `GET /health` remains dependency-independent liveness. `GET /ready` checks driver connectivity, explicit database identity, migration history and catalog readiness through V4 without scanning the friendship graph. `Neo4jModule` owns the application-scoped driver and managed transaction helpers. Friendship writes serialize on one pair control node and re-check under the lock. All modules derive actor identity from the authenticated principal and use explicit privacy-safe projections. CSRF and exact-origin validation cover unsafe HTTP requests. Build records report V4 applied to both approved databases; resumed Step 6 gates and real-stack regressions verified the restricted `isn-test` V4 state and restored its baseline. See [Neo4j operations](../development/neo4j-operations.md). There is no global `/api` prefix; `/api` browser routing is development-proxy routing only.

Configuration accepts `NODE_ENV` values `development`, `test`, `production`; `PORT` must be an integer 1–65535; `HOST` and Neo4j connection settings must be non-empty/valid. Development is pinned to `isn-dev`; test mode requires `isn-test` and separate test credentials. Defaults remain port 3000 and loopback `127.0.0.1`. Tests are API-local Jest; HTTP contracts use API-local Supertest E2E. See [Neo4j operations](../development/neo4j-operations.md) for schema and environment procedures.

## Extension guidance

Add a Nest feature module when a real domain responsibility is approved. Keep controller boundary concerns separate from application behavior; introduce providers, persistence adapters, DTO validation and shared technical modules only when required by actual behavior. Define cross-module dependency direction and transaction boundaries as the domain grows; the implemented health/auth foundation does not establish future social-domain decisions.

Posts/interactions, recommendations, account recovery, production routing/deployment, distributed abuse protection and production event retention remain unimplemented or undecided. Current restricted `isn-test` V4 verification is recorded in the Neo4j operations record. Activity-event pruning is intentionally absent pending data-governance approval.
