# API contracts

This directory documents HTTP behavior implemented by the NestJS API. The
contract is code-backed and currently limited to liveness/readiness and the
authentication foundation; proposal-level social features are not API routes.

## Documents

- [Authentication](authentication.md) — browser session, CSRF, request and
  response contracts, errors, limits, and persistence semantics.
- [OpenAPI 3.1](openapi.yaml) — machine-readable contract for health/readiness
  and authentication routes.

## Routing

NestJS exposes routes at the paths shown in OpenAPI (for example
`POST /auth/login`). The React client uses `/api` as its browser base path, and
the Vite **development-only** proxy strips that prefix. This repository does
not configure production routing, CORS, or a reverse proxy. Production must
provide an explicitly reviewed same-origin route or a separately secured
cross-origin deployment.

Update the prose and OpenAPI document alongside endpoint changes. Verify them
against the controller, validation, HTTP contract tests, and observed responses;
do not document planned social capabilities as implemented.
