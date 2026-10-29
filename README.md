# Intelligent Social Network

A university Big Data project foundation for an intelligent social network. The implemented application includes the NestJS API, React/Weylume public and authenticated journeys, Neo4j connectivity and migrations, email/password browser sessions, authenticated profiles, and member discovery. A separate synthetic static graph-edge Spark ETL is implemented; Posts/interactions, friendships, live event processing, ML and application/ETL integration remain planned.

## Status

**Neo4j V1–V3 migrations, authenticated dev/test isolation, live readiness, authentication, and User Profile & Discovery are implemented and verified.** The standalone synthetic graph-edge ETL is implemented and has Build tests, but its independent synthetic acceptance and review remain incomplete. The API exposes `GET /health`, migration-aware `GET /ready`, browser authentication, profile read/edit, and authenticated member browse/search. The React client provides Vietnamese responsive account, profile, and discovery screens. The ETL writes explicit Bronze/Silver/quarantine/Gold Parquet contracts from a locally supplied checksum-pinned edge list. SNAP rights/checksum and real-source acceptance remain unresolved; posts/interactions, friendships, account recovery, event processing, trained models, application integration and production deployment are not implemented. Activity-event retention is undecided; no automatic pruning is configured.

## Stack and architecture

- npm workspaces: `apps/api` (NestJS 12, TypeScript) and `apps/web` (React 19, TypeScript, Vite 8, React Router 7).
- API: NestJS Modular Monolith; root composition includes validated configuration, Neo4j migrations, health, authentication, and users modules.
- Web: Feature-Based organization with one router, auth/profile/discovery features, and shared HTTP/config boundaries.
- Planned direction: Neo4j for social graph/application data, application/event integration, PySpark feature processing, and Python/scikit-learn models for friend recommendation and anomaly detection. The separate static edge-list ETL is implemented; it is not an application service.

```text
apps/api/  NestJS application and API-local Jest/Supertest tests
apps/web/  React application and app-local Vitest/RTL tests
data-pipeline/  Standalone PySpark edge-list ETL and Docker runtime contract
tests/     Root unit/integration scenarios and Playwright browser QA
docs/      Business, architecture, Big Data, development and roadmap documents
```

## Prerequisites and quick start

Use Node.js `>=24.15.0 <25` and npm `>=11.19.0 <12` (the manifest pins npm 11.19.0).

```sh
npm ci
```

Before first API startup, configure the local Neo4j settings in ignored
`apps/api/.env` and generate ignored RSA/CSRF development keys with
`npm run auth:keys`. The API requires these local key paths even for
`GET /health`; never commit generated keys or expose them through `VITE_*`.

In terminal 1, start the API:

```sh
npm run dev:api
```

In terminal 2, start the web client:

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. The API defaults to `127.0.0.1:3000`; Vite proxies `/api/*` to it. Create the web `.env` only when overriding browser settings. Do not put secrets in frontend `VITE_*` variables.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Run each development server (separate terminals) |
| `npm run build` / `npm run typecheck` | Build both workspaces / strict typecheck both |
| `npm test` | Existing app-local API Jest and Web Vitest tests |
| `npm run test:api:e2e` | API-local Supertest HTTP E2E |
| `npm run test:integration` | Root Node.js HTTP proxy integration check |
| `npm run test:e2e` | Headless Playwright desktop + mobile browser QA |
| `npm run test:e2e:auth` | Real auth browser journeys against the restricted `isn-test` database |
| `npm run test:e2e:headed` | Visible Playwright browser run |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:report` | Open the latest browser QA HTML report |
| `npm run test:root` | Root integration check + Playwright QA |
| `npm run start:api` / `npm run preview:web` | Serve built API / Vite frontend preview |

Install the browser once with `npx playwright install chromium`. Full setup and test guidance: [Development docs](docs/development/README.md). Root test placement rules: [tests/README.md](tests/README.md).

## Documentation

- [Documentation index](docs/README.md)
- [API contracts](docs/api/README.md) · [Authentication API](docs/api/authentication.md) · [User Profile & Discovery API](docs/api/user-profile-discovery.md) · [OpenAPI](docs/api/openapi.yaml)
- [Project overview](docs/overview.md) · [Roadmap](docs/roadmap.md)
- [Business requirements](docs/business/README.md)
- [Implemented architecture](docs/architecture/README.md)
- [Big Data and ML status](docs/big-data/README.md)
- [Development workflow and documentation Definition of Done](docs/development/workflow.md)

## Milestones and limitations

1. Complete the tested application foundation (done; architecture review: PASS).
2. Establish root integration and Playwright browser QA (complete); browser checks cover the health flow, fallback, failure/retry, keyboard focus and responsive layout on desktop/mobile.
3. Implement approved social-network capabilities beyond authentication and basic profile discovery, with their tests.
4. Standalone synthetic graph-edge ETL is implemented; add source-approved ingestion, events, graph storage, ML evaluation and prediction integration only through incremental approved plans.

The development proxy is not production routing. Production routing, deployment, account recovery, social APIs, live event pipelines, real SNAP acceptance and measured ML results are not configured or implemented. Synthetic ETL verification is not source acceptance. Event retention remains a data-governance decision. See [open decisions and dependencies](docs/roadmap.md).
