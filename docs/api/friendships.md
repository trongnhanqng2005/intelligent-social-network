# Friendship API

**Workstream:** ISN-A — Friendship System
**Availability:** Source/API/UI implementation is present on `feature/friendship-system`. Build records report V4 applied to both approved databases. After Neo4j Desktop was started, Step 6 read-only gates and the corrected Friendship Neo4j/browser suites passed against restricted `isn-test`, with the exact pre-test baseline restored. See the [scenario acceptance record](../../tests/e2e/friendship-system-acceptance.md) and [Neo4j operations](../development/neo4j-operations.md) for the current `isn-test` scope and evidence. This contract document itself is not database-state evidence.

## Authentication and privacy

Every route requires the existing durable session. The actor UUID always comes from that session; client-supplied actor IDs are rejected. Requests and friends lists are private to the caller. Relationship status is available only between the caller and one member. Nonparticipants cannot inspect a request (`404`). Member projections contain only `id`, `displayName`, `bio` and `location`; profile response schemas are unchanged. Every response, including errors, is `Cache-Control: no-store`.

All mutations require the configured exact `Origin` and signed `X-CSRF-Token`. POST actions require `application/json`; action bodies are exactly `{}`. DELETE has no request body and an unexpected body is `422`. JSON size and structured error conventions reuse the existing API middleware. Limits are process-local: 120 reads and 20 mutations per authenticated user per minute, with `Retry-After`; this is not a distributed production abuse-control system.

## Routes

| Method and path | Behavior |
|---|---|
| `POST /friendships/requests` | `{recipientId}`; creates a pending request, returns `201`. |
| `GET /friendships/requests?direction=received\|sent&limit=20&cursor=` | Lists only the caller's pending incoming or outgoing requests. |
| `POST /friendships/requests/{requestId}/accept` | Recipient accepts; creates an accepted friendship, returns `200`. |
| `POST /friendships/requests/{requestId}/reject` | Recipient rejects, returns `200`. |
| `POST /friendships/requests/{requestId}/cancel` | Sender cancels, returns `200`. |
| `GET /friendships?limit=20&cursor=` | Lists the caller's accepted friends. |
| `DELETE /friendships/{friendshipId}` | Either participant unfriends; idempotent `204`. Only the exact current friendship ID can be deleted. |
| `GET /friendships/status/{memberId}` | Returns caller-relative current state for one existing member. |

`POST /friendships/requests` and request-action responses contain `{request, relationship}`. Request rows contain the same request object plus a privacy-safe `member` projection. Friend rows contain `{friendshipId, friendsSince, member}`. Lists return `{items, pagination:{limit,hasMore,nextCursor}}`. Request fields are `id`, `senderId`, `recipientId`, `status`, `createdAt`, `resolvedAt`. Request statuses are `PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`.

Relationship states are `self`, `none`, `outgoing_pending`, `incoming_pending`, and `friends`. Nonapplicable IDs/timestamps are `null`. Reject/cancel/unfriend clears current relationship state; only the latest request lifecycle remains on the pair node and is not a complete Activity Events history.

## State transitions and conflicts

- No self-friendship. Per unordered pair, at most one pending request or one accepted friendship.
- A duplicate same-direction pending request returns `409 REQUEST_ALREADY_PENDING`.
- A pending reverse-direction request returns `409 INCOMING_REQUEST_EXISTS`; it is never auto-accepted.
- Sending while already friends returns `409 ALREADY_FRIENDS`.
- Re-request is allowed after reject, cancel, or unfriend; a genuinely new request/friendship gets a fresh UUID.
- A completed same-action retry returns the retained terminal result without applying another transition. Other actions against a resolved lifecycle return `409 FRIENDSHIP_STATE_CONFLICT`.
- Stale request IDs cannot mutate a newer lifecycle. Stale/missing/nonparticipant friendship IDs cannot delete another relationship; DELETE remains `204`.
- Wrong action by a participant returns `403 FRIENDSHIP_ACTION_FORBIDDEN`; a nonparticipant request ID returns `404 REQUEST_NOT_FOUND`.
- Missing member returns `404 MEMBER_NOT_FOUND`; invalid UUID, query or cursor returns `422 VALIDATION_ERROR`.

## Pagination

Default page size is 20; accepted range is 1–50. The API fetches one extra row to determine `hasMore`, returns no totals, and orders requests by request UUID and friends by counterpart UUID. Cursors are bounded to 512 characters, versioned base64url, and bound to viewer, list scope and request direction. They are navigation data, not authorization tokens; malformed, cross-viewer and wrong-list cursors return `422`. Pagination is not a snapshot across concurrent changes.

## Neo4j semantics and transaction safety

`FriendshipPair` uniquely controls a canonical unordered pair of immutable `User.id` UUIDs. Its `pairKey` is `lowUserId:highUserId`, where the lowercase UUIDs satisfy `lowUserId < highUserId`. The node retains the current/latest lifecycle, version-based lock data, and accepted friendship metadata. Pair keys, lock fields and Neo4j internal IDs never appear in responses.

An accepted pair has exactly one canonical edge `(low:User)-[:FRIEND_WITH {id,pairKey,since}]->(high:User)`. Reads traverse it symmetrically. Pending requests are not accepted graph edges and must not leak into accepted-friendship exports.

All mutations use one managed Neo4j write transaction: locate/merge the unique pair, acquire a dependent write lock through the version update, then re-read the current request/friendship ID and state before authorization/transition. The lock serializes same/opposite request races, accept/reject/cancel, and unfriend/re-friend. Acceptance creates the edge and updates pair metadata atomically; unfriend deletes the exact edge and clears current metadata atomically. UUIDs/timestamps are generated once outside retryable transaction callbacks. Unexpected orphan/mixed graph state fails closed rather than being repaired automatically.

V4 is appended as `friendship-system`; V1–V3 definitions/checksums are immutable. V4 adds unique pair/request IDs, unique canonical edge ID/pair key, and sent/received request indexes. `/ready` checks schema catalog and online indexes without scanning friendship graph data. Explicit read-only preflight and integration scenarios check graph invariants.

## Browser routes

The Vietnamese React UI adds `/ban-be`, `/ban-be/loi-moi?direction=received`, `/ban-be/loi-moi?direction=sent`, and relationship controls on `/thanh-vien/:id`. Pending and uncertain mutations reconcile from the API; the UI does not claim optimistic success. See [API/OpenAPI index](README.md), [OpenAPI](openapi.yaml), [Neo4j operations](../development/neo4j-operations.md), and [friendship integration architecture](../architecture/integration.md).
