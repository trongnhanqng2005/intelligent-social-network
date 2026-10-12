# React web application

## Implemented structure

```text
apps/web/src/
├── main.tsx                 # React StrictMode bootstrap
├── app/                     # App, single BrowserRouter, routes, global styles
├── pages/
│   ├── home/                 # Status screen, health API and health state hook
│   └── not-found/            # Unknown-route screen
├── shared/
│   ├── api/                  # Fetch-based JSON transport and typed failures
│   └── config/               # Public API base URL resolution
└── test/                    # Vitest DOM setup
```

`App` owns one `BrowserRouter`; `AppRoutes` maps `/` to home and other paths to not-found. Health logic remains inside `pages/home/`. The shared transport safely joins the configured base/path, checks HTTP and JSON failures, accepts cancellation and returns untrusted response JSON as `unknown`; the health page validates `{ status: "ok" }` at runtime. The hook exposes loading/success/error/retry, a five-second timeout, cleanup and stale-result protection.

The app uses React 19, TypeScript, Vite and React Router 7. Vitest/RTL tests live beside app source. `features/`, `entities/` and extra shared abstractions are intentionally absent until behavior creates those responsibilities.

## Boundary guidance

Keep route composition in `app/`, route-level screens in `pages/`, genuinely shared infrastructure in `shared/`, and avoid importing backend source. A feature/entity split, state library, component library and production API origin are not present or approved by this foundation.
