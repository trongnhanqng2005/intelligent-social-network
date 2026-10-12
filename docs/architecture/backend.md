# NestJS API

## Implemented structure

```text
apps/api/src/
├── main.ts                    # Nest bootstrap, validated host/port, shutdown hooks
├── app.module.ts              # Root composition
├── config/env.validation.ts   # NODE_ENV, PORT and HOST parsing/validation
└── modules/health/
    ├── health.module.ts
    └── health.controller.ts   # GET /health -> { status: "ok" }
```

`AppModule` imports global `ConfigModule` and `HealthModule`. `GET /health` returns exactly `{ "status": "ok" }`, with HTTP 200 and JSON content type. It is process liveness; it does not check a database. There is no global `/api` API prefix, business service, repository, common layer or infrastructure layer.

Configuration accepts `NODE_ENV` values `development`, `test`, `production`; `PORT` must be an integer 1–65535; `HOST` must be non-empty. Defaults are development, port 3000 and loopback `127.0.0.1`. Tests are API-local Jest; the HTTP contract uses API-local Supertest E2E.

## Extension guidance

Add a Nest feature module when a real domain responsibility is approved. Keep controller boundary concerns separate from application behavior; introduce providers, persistence adapters, DTO validation and shared technical modules only when required by actual behavior. Define cross-module dependency direction and transaction boundaries as the domain grows; the current health-only app does not establish those future decisions.

No authentication, authorization, persistence, security-header policy or production deployment is currently implemented.
