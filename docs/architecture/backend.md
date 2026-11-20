# NestJS API

## Implemented structure

```text
apps/api/src/
├── main.ts                    # Nest bootstrap, validated host/port, shutdown hooks
├── app.module.ts              # Root composition
├── config/env.validation.ts   # API and Neo4j configuration validation
├── neo4j/                     # App-scoped driver, explicit sessions, V1–V8 source migrations and readiness
└── modules/
    ├── health/                # GET /health and GET /ready
    ├── auth/                  # Registration, login, durable sessions, CSRF/origin defense
    ├── users/                 # Authenticated profile, edit, member lookup and directory
    ├── friendships/           # Friends, requests and common-neighbor recommendations
    ├── posts/                 # Authenticated Post CRUD, profile visibility and chronological Feed
    └── ml-demo/               # Admin totals, synthetic ML snapshot and durable alert review
```

`AppModule` composes configuration, health, auth, users, friendships and Posts. `GET /health` remains dependency-independent liveness. Source `GET /ready` expects V8 history and catalog. Likes & Comments are integrated through V6. `Neo4jModule` owns app-scoped sessions and a single-run explicit write helper used by Posts mutations to avoid managed-transaction callback retries. All unsafe writes retain CSRF and exact-Origin checks. See [Neo4j operations](../development/neo4j-operations.md). There is no global `/api` prefix; `/api` browser routing is development-proxy routing only.

Configuration accepts `NODE_ENV` values `development`, `test`, `production`; `PORT` must be an integer 1–65535; `HOST` and Neo4j connection settings must be non-empty/valid. Development is pinned to `isn-dev`; test mode requires `isn-test` and separate test credentials. Defaults remain port 3000 and loopback `127.0.0.1`. Tests are API-local Jest; HTTP contracts use API-local Supertest E2E. See [Neo4j operations](../development/neo4j-operations.md) for schema and environment procedures.

## Recommendations and administration

Friendships derives account recommendations from accepted two-hop paths in Neo4j. It orders eligible members by the number of distinct common friends. The research snapshot retains its synthetic identities.

Auth reads the account role when it restores a session. Admin endpoints require the current ADMIN role. V8 adds a uniqueness constraint for alert reviews keyed by snapshot and synthetic actor. The signed session token carries session identity.

## Extension guidance

Add a Nest feature module when a real domain responsibility is approved. Keep controller boundary concerns separate from application behavior; introduce providers, persistence adapters, DTO validation and shared technical modules only when required by actual behavior. Define cross-module dependency direction and transaction boundaries as the domain grows; the implemented health/auth foundation does not establish future social-domain decisions.

Account recovery, production routing and deployment, distributed abuse protection and production event retention remain unimplemented or undecided. Focused real Posts persistence and query-plan evidence are recorded for restricted `isn-test`; they are not production evidence or Step 5 acceptance. Activity Logging v1 adds research-only domain-event capture inside existing write transactions. See [activity contract and operations](../big-data/activity-logging.md).
