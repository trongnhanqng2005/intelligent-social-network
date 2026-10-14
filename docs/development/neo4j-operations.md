# Neo4j local operations

## Approved runtime and credentials

The project targets the Owner-provisioned Neo4j Desktop 2.2.1 / Server 2026.09.0 Enterprise instance at `neo4j://127.0.0.1:7687`, with existing databases `isn-dev` and `isn-test`. Do not install another DBMS, recreate either database, reset it, or seed application data.

- Development/API and one-time provisioning use `apps/api/.env` with `NEO4J_DATABASE=isn-dev` and `NEO4J_USERNAME` / `NEO4J_PASSWORD`.
- `npm run neo4j:provision-test` uses that administrator credential only for explicit user/role setup. It generates `isn_test_runner`'s password using Node's cryptographic random generator and writes it to ignored `apps/api/.env.test.local` (best-effort owner-only file permissions). It never prints the password. Keep the file local; do not put it in chat, shell arguments, logs, or source control.
- Real DB tests and test migrations load only `apps/api/.env.test.local`, set `NODE_ENV=test`, and require `NEO4J_DATABASE=isn-test`. They do not load development `.env` or pass development credentials. Configuration validates the exact test target.
- Browser/API contract tests use explicit non-routable dummy Neo4j settings and are not database evidence.

The provisioner checks the reserved username and role before acting. If they exist, it verifies the known local credential, account home/status/roles, and the exact role privilege set; it refuses to rotate a password or repair unexpected assignments/grants. Re-running after successful provisioning is safe. If setup is interrupted, inspect the user, role, privilege list, and ignored credential file before retrying; do not manually broaden the role.

The dedicated role is limited to `isn-test`: `ACCESS`, explicit `DENY ACCESS` on `isn-dev`, create/show constraints and indexes, new schema names, foundation metadata access, and property/label/relationship-scoped Authentication, profile and Friendship access. The provisioner fails closed unless it verifies the feature branch, loopback runtime, exact target identity/database ID, V1–V3 history/checksums/catalog, Friendship namespace, and active-transaction gate; on a V4 database it verifies the V4 catalog. It registers only approved schema tokens and the explicit `FriendshipPair`/`FRIEND_WITH` privileges. It records application graph counts and verifies they are unchanged. Neo4j activates fine-grained grants only for existing tokens; token registration changes schema token metadata, not application records. The role is not granted `admin`, `architect`, or unrestricted graph privileges. Verify actual identity/roles and prove `isn-dev` access is denied before and after provisioning.

## Explicit schema migrations

Migrations are defined in `apps/api/src/neo4j/neo4j-migrations.ts` as an ordered, versioned list. `V1 foundation-schema-marker` establishes uniqueness constraints for schema metadata/history. `V2 authentication-schema` adds unique user/session/event constraints and auth indexes. `V3 user-profile-discovery` safely initializes existing users and adds the TEXT index on `User.displayNameSearch`. `V4 friendship-system` adds unique canonical pair/request IDs, unique `FRIEND_WITH` relationship ID/pair key, and composite sent/received request indexes. V1–V3 definitions/checksums remain immutable; Friendship owns V4. No Post migration is authorized here.

Neo4j constraint/index DDL is run as explicit schema statements, outside the graph transaction that updates migration metadata. The runner therefore:

1. verifies the selected database with `CALL db.info()`;
2. inspects named constraints/indexes and compares type, entity, label, properties and index state before accepting them;
3. ensures the migration-history constraint, then records the SHA-256 definition checksum and `APPLYING` status;
4. executes the migration statements, writes the marker, verifies the resulting schema, and only then records `VERIFIED` and `verifiedAt`.

The history is stored in `ISNSchemaMigration` nodes with version, name, checksum, `appliedAt`, status, and verification time. Reapplying a verified version is a no-op. A changed applied definition, unexpected same-name constraint, wrong database, or mismatched history is reported as drift; migrations are never silently run by API startup. There is no automatic rollback or database reset.

If a process fails after an `APPLYING` record or after a DDL statement, the graph transaction cannot undo already committed schema DDL. The V4 runner refuses an interrupted V4 record or pre-existing Friendship schema/data and performs no repair. Check the explicit target, migration history, and actual catalog using the read-only status/preflight commands. Any partial state requires Owner-reviewed, narrowly scoped recovery; do not rerun writes, edit history, or alter V1–V4 definitions automatically.

## Commands

Run from the repository root:

```sh
npm run neo4j:provision-test # explicit admin-only provisioning
npm run neo4j:migrate:dev    # apply/verify schema on isn-dev
npm run neo4j:migrate:test   # apply/verify schema on isn-test
npm run neo4j:status:dev     # read-only dev migration status/verification
npm run neo4j:status:test   # read-only test migration status/verification
npm run test:neo4j:friendship-preflight # read-only V3 baseline/V4 migration gate
npm run test:neo4j:profile-preflight # read-only restricted isn-test acceptance gate
npm run test:neo4j           # real auth/profile integration; only owned synthetic records are cleaned
```

The dev and test commands load their respective local env files and verify the server-reported database identity before writes. `npm run test:neo4j` verifies the cumulative schema and uses synthetic, uniquely identified authentication/profile fixtures. It proves transactional rollback, duplicate-email races, session creation/restoration/revocation/replay denial, profile persistence/privacy/search/keyset pagination, and exactly-one-winner concurrent profile updates. Cleanup is limited to records linked to generated fixture UUIDs after positive `isn-test` identity verification; it never deletes unrelated records or accesses `isn-dev` data.

`npm run test:neo4j:friendship-preflight` is read-only and must pass on the restricted `isn-test` identity before V4 provisioning/migration; it verifies V1–V3 checksums/catalog, no Friendship graph/schema objects, application baselines and `isn-dev` denial. `npm run test:neo4j:profile-preflight` is the read-only post-V4 gate for the exact V1–V4 catalog, readiness and profile invariants. The full `npm run test:neo4j` runs serially and includes `schema.test.mjs`, which invokes `migrations.migrate()` twice and has schema/history write capability if V4 is not current. Do not run it against a shared database until the separate safety gate and write window are approved. Real friendship scenarios use exact synthetic pair/user ownership and clean only their manifest-bound fixtures.

## Readiness and health

- `GET /health` remains process liveness: HTTP 200 and exactly `{"status":"ok"}`, independent of Neo4j.
- `GET /ready` returns HTTP 200 only when Neo4j is reachable, the selected database identity matches, current migration history/checksums are verified, and required constraint/index definitions through V4 (including the V3 TEXT index and V4 composite indexes) are online. It does not scan Friendship graph data. Otherwise it returns HTTP 503 with a sanitized reason; it does not expose credentials or driver diagnostics.
- API startup never applies migrations. Run an explicit migration command after reviewing its target and status.

## Verified runtime evidence (2026-10-14)

Historical pre-ISN-A evidence verified Driver 6.2.0 against Neo4j Server 2026.09.0 Enterprise, the restricted test identity and `isn-dev` denial, and V1–V3 on both approved databases. The ISN-A Build checklist records the separately gated V4 apply/verification on `isn-dev` and `isn-test`, with V1–V3 checksums unchanged. Its Step 5 record and command output recorded passing restricted `isn-test` V4 preflight, serial Neo4j regressions, and Friendship real-stack acceptance. Those are historical run results; this document does not treat them as proof of the current database state.

The first Step 6 recheck was refused while Neo4j Desktop was stopped, before identity verification. After the Owner confirmed startup, repeated `npm run test:neo4j:friendship-acceptance-preflight` gates passed against restricted `isn-test`: expected database ID, `isn_test_runner` roles and effective privileges, V1–V4 checksums/catalog, 11 constraints, 16 ONLINE indexes, valid graph invariants, denied `isn-dev`, free acceptance ports, no unknown fixture manifests and no active test transactions. The focused Friendship writer, Friendship browser acceptance, and targeted Authentication/Profile regressions then ran with exact owned-fixture cleanup. The final read-only gate confirmed the original baseline (0 users, 0 sessions, 2 auth events, 0 pairs, 0 friendship edges) and unchanged preservation fingerprint `d5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437`. No migration, provisioning, role/permission change, or `isn-dev` application-data read occurred. This is current `isn-test` evidence; do not infer a new read of `isn-dev` data. No retention/pruning is configured; real-user event retention remains pending data-governance approval.

Official references: [Driver compatibility](https://neo4j.com/docs/javascript-manual/current/install/), [database selection and queries](https://neo4j.com/docs/javascript-manual/current/query-simple/), [built-in procedures including `db.info()`](https://neo4j.com/docs/operations-manual/current/procedures/built-in-procedures/), [user management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-users/), [role management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-roles/), [database privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/database-administration/), and [graph write privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/privileges-writes/).
