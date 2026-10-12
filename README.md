# Intelligent Social Network

A university Big Data project foundation for an intelligent social network. The planned product combines core social features with graph-based friend recommendations and activity anomaly detection; only the minimal application foundation and live API health integration are implemented today.

## Status

**Foundation verified; business features and all Big Data/ML components are planned, not implemented.** The current app is a NestJS API exposing `GET /health` and a React status page that calls it through Vite's development proxy. There is no authentication, social feed, database, data pipeline, trained model, or production deployment configuration.

## Stack and architecture

- npm workspaces: `apps/api` (NestJS 12, TypeScript) and `apps/web` (React 19, TypeScript, Vite 8, React Router 7).
- API: lightweight NestJS Modular Monolith; current root module composes configuration and `HealthModule`.
- Web: Feature-Based organization with one router, a home page and shared HTTP/config boundaries.
- Planned direction: Neo4j for social graph/application data, PySpark batch processing over Parquet Bronze/Silver/Gold layers, and Python/scikit-learn models for friend recommendation and anomaly detection. These are requirements and proposals, not existing services.

```text
apps/api/  NestJS application and API-local Jest/Supertest tests
apps/web/  React application and app-local Vitest/RTL tests
tests/     Root unit/integration scenarios and Playwright browser QA
docs/      Business, architecture, Big Data, development and roadmap documents
```

## Prerequisites and quick start

Use Node.js `>=24.15.0 <25` and npm `>=11.19.0 <12` (the manifest pins npm 11.19.0).

```sh
npm ci
npm run dev:api
```

In a second terminal:

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. The API defaults to `127.0.0.1:3000`; Vite proxies `/api/*` to it. Copy `apps/api/.env.example` and `apps/web/.env.example` to corresponding `.env` files only when overriding local settings. Do not put secrets in frontend `VITE_*` variables.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Run each development server (separate terminals) |
| `npm run build` / `npm run typecheck` | Build both workspaces / strict typecheck both |
| `npm test` | Existing app-local API Jest and Web Vitest tests |
| `npm run test:api:e2e` | API-local Supertest HTTP E2E |
| `npm run test:integration` | Root Node.js HTTP proxy integration check |
| `npm run test:e2e` | Headless Playwright desktop + mobile browser QA |
| `npm run test:e2e:headed` | Visible Playwright browser run |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:report` | Open the latest browser QA HTML report |
| `npm run test:root` | Root integration check + Playwright QA |
| `npm run start:api` / `npm run preview:web` | Serve built API / Vite frontend preview |

Install the browser once with `npx playwright install chromium`. Full setup and test guidance: [Development docs](docs/development/README.md). Root test placement rules: [tests/README.md](tests/README.md).

## Documentation

- [Documentation index](docs/README.md)
- [Project overview](docs/overview.md) · [Roadmap](docs/roadmap.md)
- [Business requirements](docs/business/README.md)
- [Implemented architecture](docs/architecture/README.md)
- [Planned Big Data and ML direction](docs/big-data/README.md)
- [Development workflow and documentation Definition of Done](docs/development/workflow.md)

## Milestones and limitations

1. Complete the tested application foundation (done; architecture review: PASS).
2. Establish root integration and Playwright browser QA (complete); browser checks cover the health flow, fallback, failure/retry, keyboard focus and responsive layout on desktop/mobile.
3. Implement approved social-network business modules and their tests.
4. Add the data platform, graph storage, ETL, ML training/evaluation and prediction integration incrementally.

The development proxy is not production routing. The project has no production hosting, persistence, authentication, authorization, business APIs, dataset, or measured ML result. See [open decisions and dependencies](docs/roadmap.md).
