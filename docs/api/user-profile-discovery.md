# User Profile & Discovery API

## Scope and security

The User API provides profiles for authenticated Weylume members and a bounded
authenticated member directory. It reuses the durable Authentication session,
`AuthSessionGuard`, exact-Origin validation and signed CSRF protection. All
responses are `Cache-Control: no-store`; no email, credential, session, event,
role, Neo4j internal ID or search key is returned. Profiles are visible to
authenticated members only, not anonymous visitors.

NestJS paths below omit the development-only `/api` Vite proxy prefix.

## Profile model

Each profile is stored on the existing `User` node and uses its immutable UUID
`id`; there is no separate Profile node or public handle. New and existing users
receive `displayName = "Thành viên <first eight UUID characters>"`, empty
optional fields and version `0`. Registration initializes this data in its
existing transaction. Existing users are initialized by the explicit Neo4j V3
migration; GET requests never write profile defaults.

The owner may update only `displayName`, `bio`, and `location`. Display name is
2–80 Unicode code points; biography is optional and at most 280; location is
optional and at most 80. Inputs are NFC-normalized, trimmed and validated without
truncation; single-line whitespace is collapsed and biography line breaks are
normalized to LF. Invalid controls, bidi controls and unpaired surrogates are
rejected. Empty optional values become `null`; explicit `null` clears them.
Display name, bio and location are visible to all authenticated members. Location
is optional; users should not enter a detailed address.

Own-profile timestamps and version are server-owned and returned as `createdAt`,
`updatedAt`, and `version`. A PATCH must include `expectedVersion`. Updates are
conditional and transactional; a stale version returns `409 PROFILE_CONFLICT`
without committing. Clients must not automatically retry an uncertain mutation.

## Routes

### `GET /users/me/profile`

Requires a valid session.

**200**

```json
{
  "profile": {
    "id": "d723b01f-7048-4efd-80c7-2d59cfb88319",
    "displayName": "Nguyễn Minh An",
    "bio": "Mình thích đọc sách.",
    "location": "Đà Nẵng",
    "createdAt": "2026-10-14T10:00:00.000Z",
    "updatedAt": "2026-10-14T10:15:00.000Z",
    "version": 1
  }
}
```

### `PATCH /users/me/profile`

Requires a valid session, exact configured `Origin`, JSON, and the session-bound
`X-CSRF-Token`. The current identity comes only from the authenticated session;
there is no client-selected update target.

```json
{
  "displayName": "Nguyễn Minh An",
  "bio": "Mình thích đọc sách.",
  "location": null,
  "expectedVersion": 1
}
```

At least one editable property is required. Omitted properties remain unchanged;
`bio` and `location` accept `null` to clear. `displayName` does not accept null.
Unknown properties, including IDs, credentials, email, timestamps, roles and
version, are rejected. `expectedVersion` is a nonnegative safe integer.

**200** — complete own-profile response as above, with incremented version.

### `GET /users/{id}/profile`

Requires a valid session and UUID path parameter. The requested member's UUID is
a public resource identifier, not an authorization credential. The current
member's own ID is handled by the client as `/ho-so`.

**200**

```json
{
  "profile": {
    "id": "d723b01f-7048-4efd-80c7-2d59cfb88319",
    "displayName": "Nguyễn Minh An",
    "bio": "Mình thích đọc sách.",
    "location": "Đà Nẵng"
  }
}
```

### `GET /users?q=&limit=20&cursor=`

Requires a valid session. Missing/blank `q` browses. Nonblank search is a
case-insensitive, Vietnamese-accent-insensitive literal substring match on
display name only; it maps `đ` to `d`, accepts 2–80 normalized code points, and
does not search email, biography or location. Results exclude the current
member and sort by stable UUID ascending; this is deterministic, not relevance
ranking.

`limit` defaults to 20 and ranges from 1–50. `cursor` is a bounded, versioned
base64url keyset continuation tied to the normalized query; malformed or
query-mismatched cursors are rejected. It is not an authorization token.
Concurrent directory changes are not a snapshot; refresh to restart traversal.

**200**

```json
{
  "items": [
    {
      "id": "d723b01f-7048-4efd-80c7-2d59cfb88319",
      "displayName": "Nguyễn Minh An",
      "bio": "Mình thích đọc sách.",
      "location": "Đà Nẵng"
    }
  ],
  "pagination": { "limit": 20, "hasMore": false, "nextCursor": null }
}
```

The repository fetches at most `limit + 1` rows and exposes no total member
count. A TEXT index serves the approved display-name search predicate; the
result limit does not imply constant-time matching.

Friendship relationship state and profile actions are served separately by
`GET /friendships/status/{memberId}`; they do not add fields or relationship
data to this profile response. See the [Friendship API contract](friendships.md).

## Errors and abuse limits

Errors use the Authentication JSON envelope. Relevant outcomes: 400 malformed
request; 401 unauthenticated; 403 Origin/CSRF failure; 404 `PROFILE_NOT_FOUND`;
409 `PROFILE_CONFLICT`; 413 the existing 8 KiB body limit; 415 PATCH is not
JSON; 422 validation; 429 `RATE_LIMITED` with `Retry-After`; 503 Neo4j
unavailable. Validation details contain field messages but never submitted
values.

Per API process, the existing bounded limiter design allows 120 combined
profile/directory reads per user per minute and 20 profile updates per user per
minute. Counters reset with the process and are not distributed anti-scraping
controls. Member browsing necessarily allows authenticated enumeration within
these limits.

## Persistence and migration

Neo4j V3 (`user-profile-discovery`) is append-only after V1/V2. It refuses
unexpected partial profile data, backfills only absent defaults, verifies
profile invariants, and adds `isn_user_display_name_search`, a TEXT index on
`User.displayNameSearch`. Index definition and ONLINE state are part of schema
readiness. Migrations are explicit; API startup does not apply them and no
automatic rollback/reset is provided. See [Neo4j operations](../development/neo4j-operations.md).

The restricted `isn-test` account receives only the necessary profile property
writes on `User` and retains denied access to `isn-dev`. Rate limits are
process-local. Production abuse controls, account lifecycle/export/deletion and
personal-data retention remain separate decisions.
