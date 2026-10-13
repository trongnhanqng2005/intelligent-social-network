# Authentication API

## Scope and security model

The implemented authentication slice supports email/password registration,
login, browser-session restoration, and logout. It does not implement profile,
social, account-recovery, or administrator endpoints.

- Email is trimmed and normalized to lowercase. Passwords contain 15–128
  Unicode code points and at most 512 UTF-8 bytes. Passwords are stored as
  Argon2id hashes; plaintext is never returned.
- Sessions are signed RS256 JWTs held only in an HttpOnly cookie and are also
  backed by a Neo4j `AuthSession` record. They expire exactly 24 hours after
  issuance; every restoration/protected request checks the signature, issuer,
  audience, expiry, and matching live, unrevoked Neo4j session.
- Login rotates CSRF state into the authenticated session context. Logout
  durably revokes the Neo4j session, clears the session cookie, and rotates
  anonymous CSRF context. Revoked, expired, malformed, or replayed cookies do
  not restore a session.
- Unsafe requests require an exact configured `Origin`, JSON for register and
  login, and a signed double-submit token in `X-CSRF-Token`. Requests explicitly
  marked cross-site are rejected. Cookie `SameSite=Lax` is defense in depth, not
  a replacement for origin and token checks.
- Cookies are `HttpOnly`, `SameSite=Lax`, path `/`, and use `Secure` in
  production. Development/test cookie names are `isn_session`, `isn_csrf`, and
  `isn_csrf_context`; production uses the corresponding `__Host-` names.
- All auth responses set `Cache-Control: no-store`. Browser requests use
  credentials and must not persist tokens in local/session storage.

## Routes

The API route paths below are the NestJS paths, without the Vite development
proxy prefix. For browser development, `/api/auth/*` is proxied to `/auth/*`.

### `GET /auth/csrf`

Bootstraps or refreshes CSRF context for an anonymous browser or the current
session.

**200**

```json
{ "csrfToken": "<opaque signed token>" }
```

The response also sets HttpOnly CSRF context/token cookies. Send the returned
value as `X-CSRF-Token` on each unsafe request. This route is limited to 60
requests per client IP per minute.

### `POST /auth/register`

Requires exact configured `Origin`, `Content-Type: application/json`, and a
valid CSRF token. An existing authenticated session receives `409`.

```json
{ "email": "person@example.test", "password": "at least fifteen characters" }
```

**201**

```json
{ "user": { "id": "<uuid>", "email": "person@example.test" } }
```

Duplicate email is reported as the generic `409 REGISTRATION_CONFLICT`; the
response does not reveal whether an email is already registered. Limit: five
attempts per client IP per hour.

### `POST /auth/login`

Requires exact configured `Origin`, `Content-Type: application/json`, and a
valid anonymous CSRF token. An existing authenticated session receives `409`.

```json
{ "email": "person@example.test", "password": "your password" }
```

**200**

```json
{
  "user": { "id": "<uuid>", "email": "person@example.test" },
  "session": { "expiresAt": "2026-10-14T12:00:00.000Z" },
  "csrfToken": "<rotated opaque signed token>"
}
```

The response sets the HttpOnly session cookie and rotates CSRF state. Do not
read, store, or return the JWT itself. Invalid email/password pairs share
`401 INVALID_CREDENTIALS`. Limits: 20 attempts per client IP per 15 minutes and
10 attempts per normalized email+IP per 15 minutes.

### `GET /auth/session`

Restores the current session from the HttpOnly cookie. Each request validates
the JWT against the durable Neo4j session record.

**200**

```json
{
  "user": { "id": "<uuid>", "email": "person@example.test" },
  "session": { "expiresAt": "2026-10-14T12:00:00.000Z" }
}
```

Missing, invalid, expired, or revoked sessions receive `401 UNAUTHENTICATED`.

### `POST /auth/logout`

Requires exact configured `Origin` and a valid CSRF token bound to the current
cookie context. Logout is idempotent: a missing, invalid, expired, or already
revoked session still returns `204` after CSRF validation. Fetch `/auth/csrf`
again after cookie rotation; a stale token still receives `403`.

**204** — no response body. A valid active session is durably revoked exactly
once, cookies are cleared or rotated, and replay of the old session token is
rejected. Concurrent logout creates only one `AUTH_LOGOUT` event.

## Error envelope

Errors use one JSON envelope. For example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dữ liệu không hợp lệ.",
    "fieldErrors": { "password": ["Mật khẩu phải có từ 15 đến 128 ký tự."] }
  }
}
```

| HTTP | Codes | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON/request |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | No valid session, or generic login failure |
| 403 | `CSRF_FAILED` | Origin, cross-site, or CSRF check failed |
| 409 | `REGISTRATION_CONFLICT`, `ALREADY_AUTHENTICATED` | Duplicate email or authenticated caller attempted anonymous-only action |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body exceeds 8 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Register/login are not JSON |
| 422 | `VALIDATION_ERROR` | Email/password validation failed |
| 429 | `RATE_LIMITED` | Bounded request limit exceeded; `Retry-After` is seconds |
| 503 | `SERVICE_UNAVAILABLE` | Neo4j dependency is unavailable |

Unexpected server errors return a generic message without internal details.

## Persistence, events, and operational limits

Neo4j migration V2 adds uniqueness constraints for user ID/email, session
ID/JWT ID, and event ID, plus session-expiry and event-timestamp indexes.
Registration, successful login, failed login, and logout mutations write an
`AuthActivityEvent` in the same managed transaction as the associated account
or session change. Event types currently include `AUTH_REGISTERED`,
`AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGIN_FAILED`, and `AUTH_LOGOUT`.

Rate limiting is bounded, in-memory, and per API process. It is not a
distributed limit and resets on process restart. Production deployment needs a
separately approved shared abuse-control design and proxy/IP trust policy.

No automatic activity-event pruning or retention job is implemented. Event
retention and the use of real-user data remain pending a dedicated
data-governance decision; do not treat the test policy as production approval.

## Configuration and local verification

See [`apps/api/.env.example`](../../apps/api/.env.example) and
[Neo4j operations](../development/neo4j-operations.md). Production requires
private RSA signing key, public verification key, at least 32 random bytes of
CSRF secret, key ID, issuer, audience, and HTTPS web origin. Never expose these
values through `VITE_*` settings.

The real database scenarios use only the restricted `isn-test` principal and
synthetic accounts. `npm run test:api:e2e` uses an in-memory persistence double;
it is HTTP-contract coverage, not evidence of Neo4j behavior.
