# Environment setup

## Requirements

- Node.js `>=24.15.0 <25`.
- npm `>=11.19.0 <12` (root declares npm 11.19.0).
- A local Neo4j DBMS is required by the API. The approved development/test targets are `isn-dev` and `isn-test`; no Python, Spark or Kafka is required for Increment 1.

## Install and run

From the repository root:

```sh
npm ci
npm run dev:api
```

Open another terminal at the same root and run:

```sh
npm run dev:web
```

Browse `http://127.0.0.1:5173`; the API uses `http://127.0.0.1:3000` by default. `GET http://127.0.0.1:3000/health` remains process liveness and returns HTTP 200 with `{"status":"ok"}`. `GET /ready` requires the configured database and all currently required verified migrations (V2 for authentication), returning HTTP 200 when ready or HTTP 503 otherwise. The web health call uses `/api/health` through the Vite dev proxy.

Copy `apps/api/.env.example` to the Git-ignored `apps/api/.env` and configure `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE=isn-dev` for development. Generate ignored local RSA/CSRF keys once with `npm run auth:keys`; never commit or share them. The npm workspace runs API commands with `apps/api` as the working directory, where Nest `ConfigModule` loads `.env`; already-exported process environment variables take precedence. A bare `node -e` process does not load this file—use Node's `--env-file=apps/api/.env` for root-level one-off probes, and never print values. API startup never migrates. V2 readiness requires applying the current migration explicitly after reviewing the exact database identity and existing data; do not migrate `isn-dev` without that review/authorization. Copy `apps/web/.env.example` to `apps/web/.env` only when overriding public `VITE_API_BASE_URL` or server-only `API_PROXY_TARGET`. Never commit secrets or put private values in `VITE_*` configuration.

Run `npm run neo4j:provision-test` once to create the dedicated least-privilege account and ignored `apps/api/.env.test.local`. Then `npm run neo4j:migrate:test` applies the test schema, `npm run neo4j:status:test` verifies it, and `npm run test:neo4j` runs the real integration. `npm run test:e2e:auth` exercises the complete browser journey against that same restricted test database. Test mode rejects any target other than `isn-test` and does not load development `.env`; never reuse the development/admin credential for tests. See [Neo4j operations](neo4j-operations.md) for privileges, migration recovery, and credential handling.

## Build and serve

`npm run build` compiles both applications. `npm run start:api` starts the compiled API; build first. `npm run preview:web` serves the Vite production preview; build first. The dev proxy does not configure production routing; a same-origin reverse proxy or separately designed public API/CORS configuration is still required.
