# Posts & Feed API

**Status:** Focused Likes & Comments acceptance passed through Chromium, NestJS and Neo4j V6 on restricted `isn-test`. The test verified readiness, retries, keyset pagination, session/CSRF, ownership and exact cleanup. V1–V5 remain immutable. V6 adds the comment retry/id constraints and chronology index, with a V1–V5 baseline gate, empty-Comment preflight, and readiness catalog checks. API startup never migrates.

All paths below are NestJS paths. The browser uses `/api` through the Vite development proxy only. All listed routes require an authenticated session and return `Cache-Control: no-store`, including errors. Unsafe writes retain the existing exact-Origin and CSRF defenses.

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
| `PUT /posts/:postId/like` | Empty body | `200 {liked}`; idempotent |
| `DELETE /posts/:postId/like` | Empty body | `204`; idempotent |
| `GET /posts/:postId/comments?limit=&cursor=` | Bounded page | `200 {items, pagination}` |
| `POST /posts/:postId/comments` | JSON `{clientId, content}` | `201 {comment}`; retries keyed by viewer/post/client UUID |
| `PATCH /posts/:postId/comments/:commentId` | `{content, expectedVersion}` | `200 {comment}`; author only |
| `DELETE /posts/:postId/comments/:commentId?expectedVersion=N` | Empty body | `204`; author only, retains deletion tombstone |

All unsafe routes require the session cookie, exact `Origin`, and `X-CSRF-Token`; CSRF failures use `403 CSRF_FAILED`. Like/comment access rechecks current post visibility in the same write transaction after locking the Post. Missing and hidden posts use the same `404 POST_NOT_FOUND`; visible comments mutated by a non-author use `403 POST_ACTION_FORBIDDEN`; stale comment versions or conflicting retries use `409 POST_CONFLICT`. Comment retries are keyed by `(post, viewer, clientId)` and compare the immutable hash of the original normalized content, so the original retry still resolves after an edit. Reusing the key with different content conflicts, and a deleted comment is never recreated.

The default page size is 20; valid limits are 1–50. Pages sort by `createdAt DESC, id DESC`, use versioned keyset cursors bound to the authenticated viewer and list scope, fetch one extra row, and expose no totals or hidden-post counts. Visibility and accepted-friend filtering occur in Neo4j before page limits. The feed authors are the viewer and current accepted friends.

`PostView` has `id`, `content`, `visibility`, `createdAt`, `updatedAt`, `version`, `author: {id, displayName, bio, location}`, `permissions: {canEdit, canDelete}`, `likeCount`, `commentCount`, and `likedByViewer`. No graph-internal metadata is returned. A `PostComment` has `id`, `clientId`, `postId`, `content`, `createdAt`, `updatedAt`, `version`, `deleted`, `author: {id, displayName}`, and `permissions: {canEdit, canDelete}`. Comment reads use `{items, pagination}`; create/update use `{comment}`.

## Errors and HTTP limits

| Status | Code | Meaning |
|---|---|---|
| `401` | `UNAUTHENTICATED` | No valid authenticated session |
| `403` | `CSRF_FAILED` / `POST_ACTION_FORBIDDEN` | Origin/CSRF validation failed / visible Post or comment mutation by a non-owner/non-author; missing/invisible posts remain privacy-safe `404` |
| `404` | `POST_NOT_FOUND` / `MEMBER_NOT_FOUND` | Missing, deleted or invisible post / nonexistent profile target |
| `409` | `POST_CONFLICT` | `expectedVersion` is stale, a comment retry key conflicts, or a second deadlock aborts the request |
| `422` | `VALIDATION_ERROR` | Invalid content, visibility, UUID, version, cursor, limit or nonempty DELETE body |
| `429` | `RATE_LIMITED` | Process-local per-user limit; includes `Retry-After` |
| `503` | `WRITE_OUTCOME_UNKNOWN` | Commit result is ambiguous; caller must refresh/reconcile before manually retrying |
| `503` | `POST_DATA_INCONSISTENT` / `SERVICE_UNAVAILABLE` | Graph invariant or service failure (including Neo4j `ServiceUnavailable` and `SessionExpired`); details are sanitized |

The Posts JSON parser permits up to 32 KiB only for `POST /posts` and `PATCH /posts/:postId`; unrelated endpoints retain the existing 8 KiB cap. JSON is required for these writes. DELETE accepts no request body. Post reads are limited to 120 per user/minute and mutations to 20 per user/minute in this process. The write path uses an explicit single-run transaction; there is no automatic retry after uncertain commits.

See [OpenAPI 3.1](openapi.yaml) for machine-readable schemas and responses.
