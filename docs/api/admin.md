# Admin API

All endpoints require `AuthSessionGuard` followed by `AdminGuard`. Responses are non-cacheable. The admin role is provisioned by an operator, not through HTTP; do not attach synthetic alert actors to real identities.

## `GET /admin/stats`

Returns live Neo4j aggregate counts:

```json
{ "users": 0, "friendships": 0, "posts": 0, "comments": 0 }
```

Friendships are counted from `FRIEND_WITH` relationships. Comments count visible records. This endpoint does not return user-level data.

## Explicit operator provisioning

There is no role-management HTTP endpoint. Only after independent approval of V8, verify the exact database name and ID with `CALL db.info() YIELD name, id RETURN name, id` against the approved target. Execute a parameterized transaction only after separately confirming the exact UUID, email, and current role of the existing account:

```cypher
CALL db.info() YIELD name, id
WITH name, id WHERE name = $databaseName AND id = $databaseId
MATCH (user:User {id: $userId, email: $email})
WHERE coalesce(user.role, 'USER') = $currentRole
  AND $role IN ['USER', 'ADMIN'] AND $currentRole IN ['USER', 'ADMIN']
SET user.role = $role
RETURN name AS databaseName, id AS databaseId, user.id AS userId, user.email AS email,
       $currentRole AS previousRole, user.role AS role
```

Pass `$databaseName`, `$databaseId`, `$userId` (exact UUID), `$email`, `$currentRole` (the independently confirmed current `USER` or `ADMIN`), and `$role` (exactly `USER` or `ADMIN`) as parameters; do not interpolate values into query text. Confirm exactly one returned row and verify the returned target, identity, and prior/current roles. If no row is returned, stop and obtain fresh independent approval before trying another target or account. For a legacy account without a stored role, confirm that the current role resolves to `USER`. To revoke admin, set `$currentRole` to `ADMIN` and `$role` to `USER`. This documentation command has not been run against any database.
