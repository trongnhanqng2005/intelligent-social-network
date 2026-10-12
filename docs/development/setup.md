# Environment setup

## Requirements

- Node.js `>=24.15.0 <25`.
- npm `>=11.19.0 <12` (root declares npm 11.19.0).
- No database, Python, Neo4j, Spark or Kafka is required for the current application foundation.

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

Browse `http://127.0.0.1:5173`; the API uses `http://127.0.0.1:3000` by default. Verify directly with `GET http://127.0.0.1:3000/health`; expect HTTP 200 and `{"status":"ok"}`. The web health call uses `/api/health` through the Vite dev proxy.

Optional overrides: copy `apps/api/.env.example` to `apps/api/.env` for `NODE_ENV`, `PORT`, `HOST`; copy `apps/web/.env.example` to `apps/web/.env` for public `VITE_API_BASE_URL` and server-only `API_PROXY_TARGET`. These are local examples; never commit secrets or put private values in `VITE_*` configuration.

## Build and serve

`npm run build` compiles both applications. `npm run start:api` starts the compiled API; build first. `npm run preview:web` serves the Vite production preview; build first. The dev proxy does not configure production routing; a same-origin reverse proxy or separately designed public API/CORS configuration is still required.
