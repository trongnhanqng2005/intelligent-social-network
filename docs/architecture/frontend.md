# React web application

## Implemented structure

```text
apps/web/src/
├── main.tsx                 # React StrictMode bootstrap and CSS entry points
├── app/                     # App, single BrowserRouter, routes and design tokens
├── features/
│   └── auth/                 # Auth API, session state, Vietnamese account UI/tests
├── pages/
│   ├── home/                 # Weylume public homepage and responsive presentation
│   └── not-found/            # Unknown-route screen
└── shared/
    ├── api/                  # Fetch-based JSON transport and typed failures
    ├── brand/                # Weylume mark and lockup
    ├── config/               # Public API base URL resolution
    └── ui/                   # Shared presentation primitives and CSS
```

`App` owns one `BrowserRouter`; `AppRoutes` maps `/`, `/dang-nhap`, and
`/dang-ky`, with unknown paths to not-found. The auth feature owns request and
response validation, loading/anonymous/authenticated/unavailable session states,
expiry and cross-tab notifications. Authentication keeps JWTs in HttpOnly
cookies and handles signed CSRF tokens in memory only.

The Weylume homepage is a public product introduction and does not call `/health`
to render connectivity status. API liveness/readiness and the Vite proxy remain
independent backend/development contracts. See [integration](integration.md).

The app uses React 19, TypeScript, Vite, React Router 7, `lucide-react`, plain CSS
and the shared design primitives. `apps/web/src/app/styles/tokens.css` is the
single runtime source for primitive, semantic and component design tokens.
Vitest/RTL tests live beside app source. No entity layer, general state library,
CSS framework or component framework is present.

## Boundary guidance

Keep route composition in `app/`, route-level screens in `pages/`, feature
behavior in its owning `features/` module, genuinely shared presentation in
`shared/ui/`, brand assets/components in `shared/brand/`, and infrastructure in
`shared/api/` and `shared/config/`. Shared UI must not import authentication
services or state. Do not import backend source into the browser.

Future Profile, Friends, Feed and Recommendation tasks should reuse the documented
[Weylume design system](../design/frontend-design-system.md), without treating
those planned capabilities as implemented.
