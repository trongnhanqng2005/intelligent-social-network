# Posts & Feed API

**Status:** The feature branch contains the Posts API and additive V5 migration source. Under separate Owner authorization, V5 and its exact Post/AUTHORED grant delta were applied to restricted `isn-test`; the focused real-Neo4j suite, production feed query-plan check, exact cleanup, and baseline restoration passed. No `isn-dev` Posts status or production readiness is inferred. This contract describes source behavior and test-database evidence, not production readiness.

All paths below are NestJS paths. The browser uses `/api` through the Vite development proxy only. All six routes require an authenticated session and return `Cache-Control: no-store`, including errors. Unsafe writes retain the existing exact-Origin and CSRF defenses.

## Visibility and content

- `members`: readable by any authenticated member.
- `friends`: readable by the owner or a member with a current accepted canonical friendship. A new friend may read earlier friends-only posts; unfriending removes access.
- New posts default to `friends`. Visibility is immutable.
- Content is NFC-normalized; CRLF/CR become LF; outer whitespace is trimmed. A post must contain visible text and have at most 2,000 normalized Unicode code points. The request schema does not cap raw length because normalization may reduce it. HTML/Markdown/media are not interpreted; text is rendered literally.
- The API derives authorship from the session, uses server UTC timestamps, and returns only the post and approved author projection. Permission flags are UI hints; every mutation reauthorizes.

## Routes

| Method and path | Request | Success |
|---|---|---|
| `POST /posts` | JSON `{content, visibility?}` | `201 {post}`; visibility defaults to `friends` |
| `GET /posts/:postId` | UUID path | `200 {post}` if visible |
| `PATCH /posts/:postId` | JSON `{content, expectedVersion}` | `200 {post}`; owner only; visibility unchanged |
| `DELETE /posts/:postId?expectedVersion=N` | Empty body; owner only | `204`; permanent |
| `GET /users/:memberId/posts?limit=&cursor=` | UUID path; bounded page | `200 {items, pagination}` |
| `GET /feed?limit=&cursor=` | Bounded page | `200 {items, pagination}` |

The default page size is 20; valid limits are 1–50. Pages sort by `createdAt DESC, id DESC`, use versioned keyset cursors bound to the authenticated viewer and list scope, fetch one extra row, and expose no totals or hidden-post counts. Visibility and accepted-friend filtering occur in Neo4j before page limits. The feed authors are the viewer and current accepted friends.

`PostView` has `id`, `content`, `visibility`, `createdAt`, `updatedAt`, `version`, `author: {id, displayName, bio, location}`, and `permissions: {canEdit, canDelete}`. No graph-internal metadata is returned.

## Errors and HTTP limits

| Status | Code | Meaning |
|---|---|---|
| `401` | `UNAUTHENTICATED` | No valid authenticated session |
| `403` | `POST_ACTION_FORBIDDEN` | Visible post mutation by a non-owner; missing/invisible posts remain privacy-safe `404` |
| `404` | `POST_NOT_FOUND` / `MEMBER_NOT_FOUND` | Missing, deleted or invisible post / nonexistent profile target |
| `409` | `POST_CONFLICT` | `expectedVersion` is stale; no edit/delete is applied |
| `422` | `VALIDATION_ERROR` | Invalid content, visibility, UUID, version, cursor, limit or nonempty DELETE body |
| `429` | `RATE_LIMITED` | Process-local per-user limit; includes `Retry-After` |
| `503` | `WRITE_OUTCOME_UNKNOWN` | Commit result is ambiguous; caller must refresh/reconcile before manually retrying |
| `503` | `POST_DATA_INCONSISTENT` / `SERVICE_UNAVAILABLE` | Graph invariant or service failure (including Neo4j `ServiceUnavailable` and `SessionExpired`); details are sanitized |

The Posts JSON parser permits up to 32 KiB only for `POST /posts` and `PATCH /posts/:postId`; unrelated endpoints retain the existing 8 KiB cap. JSON is required for these writes. DELETE accepts no request body. Post reads are limited to 120 per user/minute and mutations to 20 per user/minute in this process. The write path uses an explicit single-run transaction; there is no automatic retry after uncertain commits.

See [OpenAPI 3.1](openapi.yaml) for machine-readable schemas and responses.
