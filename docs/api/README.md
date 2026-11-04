# API contracts

This directory documents HTTP behavior implemented by the NestJS API. The
contract covers liveness/readiness, Authentication, User Profile & Discovery,
and the Friendship System source contract. Posts & Feed source contracts are
implemented on the feature branch; a separately Owner-authorized continuation
applied V5 and verified focused real Posts behavior on restricted `isn-test`,
with exact fixture cleanup and baseline restoration. This is not evidence about
`isn-dev` or production readiness. Historical V1–V4 and Friendship evidence
remains separately recorded in the database-operation and acceptance records.

## Documents

- [Authentication](authentication.md) — browser session, CSRF, request and
  response contracts, errors, limits, and persistence semantics.
- [User Profile & Discovery](user-profile-discovery.md) — profile privacy,
  edits, search and cursor pagination.
- [Friendships](friendships.md) — request state machine, private lists,
  canonical graph and authenticated API behavior.
- [Posts & Feed](posts-feed.md) — approved visibility, content, CRUD, feed,
  pagination, concurrency and error contracts; V5 operational state is separate.
- [OpenAPI 3.1](openapi.yaml) — machine-readable contract for health/readiness,
  Authentication, User, Friendship, Posts and Feed routes.

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
