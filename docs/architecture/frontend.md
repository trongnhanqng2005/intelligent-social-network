# React web application

## Implemented structure

```text
apps/web/src/
├── main.tsx                 # React StrictMode bootstrap
├── app/                     # App, single BrowserRouter, routes, global styles
├── features/
│   └── auth/                 # Auth API, session context, Vietnamese account UI and tests
├── pages/
│   ├── home/                 # Community home, API status and health state hook
│   └── not-found/            # Unknown-route screen
├── shared/
│   ├── api/                  # Fetch-based JSON transport and typed failures
│   └── config/               # Public API base URL resolution
└── test/                    # Vitest DOM setup
```

`App` owns one `BrowserRouter`; `AppRoutes` maps `/`, `/dang-nhap`, and `/dang-ky`, with unknown paths to not-found. The auth feature owns auth API request/response validation, loading/anonymous/authenticated/unavailable state, session expiry and cross-tab notifications. The home view combines community copy with the independent `/health` status card. The shared health transport returns untrusted response JSON as `unknown`; the health page validates `{ status: "ok" }` at runtime. Authentication keeps JWTs in HttpOnly cookies and handles signed CSRF tokens in memory only.

The app uses React 19, TypeScript, Vite, React Router 7 and `lucide-react`. Vitest/RTL tests live beside app source. No entity layer or general state library is present.

## Boundary guidance

Keep route composition in `app/`, route-level screens in `pages/`, genuinely shared infrastructure in `shared/`, and avoid importing backend source. A feature/entity split, state library, component library and production API origin are not present or approved by this foundation.
