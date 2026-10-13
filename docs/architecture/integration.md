# API and frontend integration

## Implemented health contract

```http
GET /health
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

The browser's public base path defaults to `/api`; Vite's **development server** forwards `/api/health` to the server-only `API_PROXY_TARGET` (default `http://127.0.0.1:3000`) after removing `/api`. The actual API route remains `/health`. Browser code must not receive the proxy target as a `VITE_*` variable.

```mermaid
sequenceDiagram
  participant UI as Home status hook
  participant HTTP as Shared fetch client
  participant Vite as Vite development proxy
  participant API as NestJS
  UI->>HTTP: checkApiHealth()
  HTTP->>Vite: GET /api/health
  Vite->>API: GET /health (prefix removed)
  API-->>Vite: 200 {"status":"ok"}
  Vite-->>HTTP: JSON response
  HTTP-->>UI: unknown payload
  UI->>UI: validate health contract; display state
```

The frontend checks status, parses JSON as unknown and validates the health response. The UI does not present a connected state until the response passes validation. A development proxy failure is actionable and retryable.

## Boundaries and future API

The Vite proxy is not a production deployment rule. Production use of relative `/api` requires an independently configured same-origin reverse proxy; cross-origin configuration would need separately approved CORS policy. No production endpoint is configured or verified.

Other business API contracts (profiles, posts, friendships, and similar social capabilities) are not implemented. Before adding cross-component features, document request/response schemas, errors, auth, ownership/authorization, event effects, persistence semantics and test locations in the relevant approved feature task. Do not use the health endpoint as a business API template beyond its deliberately minimal contract.

## Authentication browser contract

The browser calls `/api/auth/*`; Vite strips `/api` and forwards to the
NestJS `/auth/*` routes. Registration/login/logout use JSON, exact configured
`Origin`, and a CSRF token returned from `GET /auth/csrf`. The session JWT is
HttpOnly-cookie-only; `/auth/session` checks both the JWT and the durable
Neo4j session record. Login/logout rotate CSRF state. See
[authentication API](../api/authentication.md) and its
[OpenAPI contract](../api/openapi.yaml).
