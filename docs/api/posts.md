# Posts and feed API

## Scope

The Posts increment provides authenticated text posts, a chronological feed,
and friend-only likes, comments, and shares. Media, ranking, recommendations,
and moderation are separate planned increments.

All responses use `Cache-Control: no-store`. Every route requires the durable
session cookie. `POST`, `PATCH` and `DELETE` require the configured Origin and a
signed `X-CSRF-Token`, obtained from `GET /auth/csrf`.

Post content is trimmed before persistence and must contain 1–2,000 Unicode
code points. The API returns the author display name and a `mine` flag; private
email addresses are never included.

## Routes

| Method and path | Behavior |
|---|---|
| `GET /posts/feed?limit=20&cursor=` | Lists the caller's posts and posts by accepted friends, newest first. |
| `POST /posts` | Creates a post with `{ "content": "..." }`; returns `201` and `{ post }`. |
| `PATCH /posts/{id}` | Replaces content; only the author may update it. |
| `DELETE /posts/{id}` | Deletes the author's post and returns `204`. |
| `POST /posts/{id}/like` | Likes a visible post; idempotently returns `{ "active": true }`. |
| `DELETE /posts/{id}/like` | Removes the caller's like; returns `{ "active": false }`. |
| `POST /posts/{id}/share` | Shares a visible post; idempotently returns `{ "active": true }`. |
| `DELETE /posts/{id}/share` | Removes the caller's share; returns `{ "active": false }`. |
| `GET /posts/{id}/comments` | Lists comments for a visible post in creation order. |
| `POST /posts/{id}/comments` | Adds `{ "content": "..." }`; comments are limited to 1–1,000 Unicode code points. |
| `DELETE /posts/{id}/comments/{commentId}` | Deletes the comment; only its author may do so. |

The default page size is 20 and the maximum is 50. The feed uses a bounded,
versioned base64url cursor containing the last `createdAt` and post ID. Ordering
is deterministic by `createdAt DESC, id DESC`. A cursor is navigation data, not
an authorization token.

## Authorization and persistence

The authenticated principal is always the post author for creation; clients
cannot supply an author ID. Update and delete operations fail with
`POST_FORBIDDEN` for another author's post. A missing post returns
`POST_NOT_FOUND`.

Neo4j V5 adds a unique `Post.id` constraint and indexes for chronological and
author-scoped feed access. Posts reference their author by the immutable
`authorId` property. The application feed includes accepted `FRIEND_WITH`
relationships only; pending requests do not expose posts.

## Errors and limits

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | No valid session. |
| 403 | `CSRF_FAILED`, `POST_FORBIDDEN` | Request security or ownership failure. |
| 404 | `POST_NOT_FOUND` | Post does not exist. |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body exceeds the application limit. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A mutation is not JSON. |
| 422 | `VALIDATION_ERROR` | Empty, oversized or malformed content/cursor. |
| 429 | `RATE_LIMITED` | More than 20 writes or 120 reads per user per minute. |

Feed post projections include `likeCount`, `commentCount`, `shareCount`,
`likedByMe`, and `sharedByMe`. Interaction writes are allowed only for the
author or an accepted friend; pending requests cannot view or mutate a post.
Likes and shares are unique per user/post and repeated activation is safe.
Comments are stored as `Comment` nodes with `postId` metadata.

The current increment stores no activity-event record for posts or
interactions. Event integration and retention remain separate data-governance
work.
