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

Browse `http://127.0.0.1:5173`; the API uses `http://127.0.0.1:3000` by default. `GET http://127.0.0.1:3000/health` remains process liveness and returns HTTP 200 with `{"status":"ok"}`. `GET http://127.0.0.1:3000/ready` checks the configured database and foundation schema, returning HTTP 200 when ready or HTTP 503 with a sanitized reason otherwise. The web health call uses `/api/health` through the Vite dev proxy.

Copy `apps/api/.env.example` to the Git-ignored `apps/api/.env` and configure `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE=isn-dev` for development. The npm workspace runs API commands with `apps/api` as the working directory, where Nest `ConfigModule` loads `.env`; already-exported process environment variables take precedence. A bare `node -e` process does not load this file—use Node's `--env-file=apps/api/.env` for root-level one-off probes, and never print values. Run `npm run neo4j:migrate:dev` to apply and verify the foundation migration explicitly; API startup never migrates. Copy `apps/web/.env.example` to `apps/web/.env` only when overriding public `VITE_API_BASE_URL` or server-only `API_PROXY_TARGET`. Never commit secrets or put private values in `VITE_*` configuration.

Run `npm run neo4j:provision-test` once to create the dedicated least-privilege account and ignored `apps/api/.env.test.local`. Then `npm run neo4j:migrate:test` applies the test schema, `npm run neo4j:status:test` verifies it, and `npm run test:neo4j` runs the real integration. Test mode rejects any target other than `isn-test` and does not load development `.env`; never reuse the development/admin credential for tests. See [Neo4j operations](neo4j-operations.md) for privileges, migration recovery, and credential handling.

## Build and serve

`npm run build` compiles both applications. `npm run start:api` starts the compiled API; build first. `npm run preview:web` serves the Vite production preview; build first. The dev proxy does not configure production routing; a same-origin reverse proxy or separately designed public API/CORS configuration is still required.
