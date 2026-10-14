# API and frontend integration

## Implemented health contract

```http
GET /health
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

The browser API base path defaults to `/api`; Vite's **development server** forwards `/api/*` to the server-only `API_PROXY_TARGET` (default `http://127.0.0.1:3000`) after removing `/api`. Browser code must not receive the proxy target as a `VITE_*` variable. The public homepage does not make a health request; the root proxy test validates the infrastructure boundary independently.

The Weylume public homepage does not call `/health` or display service
connectivity. Liveness/readiness endpoints remain backend operational contracts.

### Authenticated User API

The browser calls `/api/users/*`; Vite strips `/api` and forwards to the
NestJS Users routes. `/users/me/profile` reads/updates only the current
principal's profile; `/users` browses/searches authenticated members with
bounded UUID keyset pagination; `/users/{id}/profile` returns only the approved
member-visible projection. All User responses are `Cache-Control: no-store`.
PATCH uses the existing Origin/CSRF protection and expected-version conflict
handling. See the [User Profile & Discovery API](../api/user-profile-discovery.md)
and [OpenAPI contract](../api/openapi.yaml).

## Boundaries and future API

The Vite proxy is not a production deployment rule. Production use of relative `/api` requires an independently configured same-origin reverse proxy; cross-origin configuration would need separately approved CORS policy. No production endpoint is configured or verified.

The Friendship API source contract is implemented in the approved workstream:
all routes use authenticated identity, private caller-owned lists, CSRF/Origin
protection, no-store responses and managed Neo4j pair transactions. Build
records report V4 applied to both approved databases; resumed Step 6 gates and
real-stack tests verified the restricted `isn-test` V4 state and restored its
baseline. See
[Friendships](../api/friendships.md).
Posts, interactions and recommendations remain unimplemented. Do not use the
health endpoint as a business API template beyond its deliberately minimal
contract.

## Authentication browser contract

The browser calls `/api/auth/*`; Vite strips `/api` and forwards to the
NestJS `/auth/*` routes. Registration/login/logout use JSON, exact configured
`Origin`, and a CSRF token returned from `GET /auth/csrf`. The session JWT is
HttpOnly-cookie-only; `/auth/session` checks both the JWT and the durable
Neo4j session record. Login/logout rotate CSRF state. See
[authentication API](../api/authentication.md) and its
[OpenAPI contract](../api/openapi.yaml).
