# Neo4j local operations

## Approved runtime and credentials

The project targets the Owner-provisioned Neo4j Desktop 2.2.1 / Server 2026.09.0 Enterprise instance at `neo4j://127.0.0.1:7687`, with existing databases `isn-dev` and `isn-test`. Do not install another DBMS, recreate either database, reset it, or seed application data.

- Development/API and one-time provisioning use `apps/api/.env` with `NEO4J_DATABASE=isn-dev` and `NEO4J_USERNAME` / `NEO4J_PASSWORD`.
- `npm run neo4j:provision-test` uses that administrator credential only for explicit user/role setup. It generates `isn_test_runner`'s password using Node's cryptographic random generator and writes it to ignored `apps/api/.env.test.local` (best-effort owner-only file permissions). It never prints the password. Keep the file local; do not put it in chat, shell arguments, logs, or source control.
- Real DB tests and test migrations load only `apps/api/.env.test.local`, set `NODE_ENV=test`, and require `NEO4J_DATABASE=isn-test`. They do not load development `.env` or pass development credentials. Configuration validates the exact test target.
- Browser/API contract tests use explicit non-routable dummy Neo4j settings and are not database evidence.

The provisioner checks the reserved username and role before acting. If they exist, it verifies the known local credential, account home/status/roles, and the exact role privilege set; it refuses to rotate a password or repair unexpected assignments/grants. Re-running after successful provisioning is safe. If setup is interrupted, inspect the user, role, privilege list, and ignored credential file before retrying; do not manually broaden the role.

The dedicated role is limited to `isn-test`: `ACCESS`, explicit `DENY ACCESS` on `isn-dev`, create/show constraints and indexes, new schema names, foundation metadata access, and property/label/relationship-scoped Authentication, profile, Friendship and Posts access. ISN-C adds a separate Post-specific provisioner that grants only 14 Post/AUTHORED commands after it proves the existing V4 role set exactly matches the reviewed manifest. It never repairs or broadens unexpected grants. The full preflight verifies actual identity/roles and denied `isn-dev` access before and after provisioning. The role is not granted `admin`, `architect`, or unrestricted graph privileges.

## Explicit schema migrations

Migrations are defined in `apps/api/src/neo4j/neo4j-migrations.ts` as an ordered, versioned list. `V1 foundation-schema-marker` establishes uniqueness constraints for schema metadata/history. `V2 authentication-schema` adds unique user/session/event constraints and auth indexes. `V3 user-profile-discovery` safely initializes existing users and adds the TEXT index on `User.displayNameSearch`. `V4 friendship-system` adds unique canonical pair/request IDs, unique `FRIEND_WITH` relationship ID/pair key, and composite sent/received request indexes. `V5 posts-feed` adds a unique Post ID constraint and author/chronology index. V1–V4 definitions/checksums are preserved. Under separate Owner authorization, V5 was applied and verified on restricted `isn-test`; no `isn-dev` Posts status is inferred.

Neo4j constraint/index DDL is run as explicit schema statements, outside the graph transaction that updates migration metadata. The runner therefore:

1. verifies the selected database with `CALL db.info()`;
2. inspects named constraints/indexes and compares type, entity, label, properties and index state before accepting them;
3. ensures the migration-history constraint, then records the SHA-256 definition checksum and `APPLYING` status;
4. executes the migration statements, writes the marker, verifies the resulting schema, and only then records `VERIFIED` and `verifiedAt`.

The history is stored in `ISNSchemaMigration` nodes with version, name, checksum, `appliedAt`, status, and verification time. Reapplying a verified version is a no-op. A changed applied definition, unexpected same-name constraint, wrong database, or mismatched history is reported as drift; migrations are never silently run by API startup. There is no automatic rollback or database reset.

If a process fails after an `APPLYING` record or after a DDL statement, the graph transaction cannot undo already committed schema DDL. The runner refuses interrupted V4/V5 records or pre-existing reserved Friendship/Posts schema/data and performs no repair. Before V5 it requires a verified V1–V4 history and catalog, exact database identity, and no existing Post/AUTHORED data or reserved schema objects. The Posts preflight also checks the live V4 preservation fingerprint and effective grants, and is repeated between role provisioning and migration. Any partial state requires Owner-reviewed, narrowly scoped recovery; do not rerun writes, edit history, or alter V1–V5 definitions automatically.

## Commands

Run from the repository root:

```sh
npm run neo4j:provision-test # explicit admin-only provisioning
npm run neo4j:provision-posts-test-role # only after the read-only V4 Posts gate and Owner-approved write window
npm run neo4j:migrate:dev    # apply/verify schema on isn-dev
npm run neo4j:migrate:test   # apply/verify schema on isn-test
npm run neo4j:migrate:posts-test # Posts preflight → Post grants → repeated preflight → explicit V5 apply
npm run neo4j:status:dev     # read-only dev migration status/verification
npm run neo4j:status:test   # read-only test migration status/verification
npm run test:neo4j:friendship-preflight # read-only V3 baseline/V4 migration gate
npm run test:neo4j:profile-preflight # read-only restricted isn-test acceptance gate
npm run test:neo4j:posts-preflight # read-only V1–V4 gate before initial V5 application; before/after Post grants
npm run test:neo4j:posts # focused V5 Posts/Feed real-database suite; exact fixture cleanup
npm run test:neo4j           # real auth/profile integration; only owned synthetic records are cleaned
```

The dev and test commands load their respective local env files and verify the server-reported database identity before writes. `npm run test:neo4j` verifies the cumulative schema and uses synthetic, uniquely identified authentication/profile fixtures. It proves transactional rollback, duplicate-email races, session creation/restoration/revocation/replay denial, profile persistence/privacy/search/keyset pagination, and exactly-one-winner concurrent profile updates. Cleanup is limited to records linked to generated fixture UUIDs after positive `isn-test` identity verification; it never deletes unrelated records or accesses `isn-dev` data.

`npm run test:neo4j:friendship-preflight` is read-only and must pass on the restricted `isn-test` identity before V4 provisioning/migration; it verifies V1–V3 checksums/catalog, no Friendship graph/schema objects, application baselines and `isn-dev` denial. The profile readiness preflight now checks the current V5 catalog. `npm run test:neo4j:posts-preflight` is read-only: it proves the expected V1–V4 history/checksums/catalog and preservation baseline, rejects unexpected Post data/schema/V5 history, checks the exact V4 or V4+14-grant role set, verifies denied `isn-dev`, and requires no active test transaction. `npm run neo4j:migrate:posts-test` repeats that preflight before and after the Post-only grants, then uses the explicit migration runner. `npm run test:neo4j:posts` never migrates or grants and requires current V5. Both Post writer commands require the invocation-only `ISN_TEST_WRITE_WINDOW=owner-approved` flag, which must be set only after the Project Owner confirms the exclusive `isn-test` write window; the flag itself is not proof of exclusivity. Keep all phases serial. The current `test:neo4j` selection runs Authentication/Profile plus schema readiness; the separate historical Friendship writer remains V4-gated. Real friendship and Posts scenarios use durable exact synthetic ownership and clean only their manifest-bound fixtures.

## Readiness and health

- `GET /health` remains process liveness: HTTP 200 and exactly `{"status":"ok"}`, independent of Neo4j.
- `GET /ready` returns HTTP 200 only when Neo4j is reachable, the selected database identity matches, current migration history/checksums are verified, and required constraint/index definitions through V5 (including the V3 TEXT index, V4 composite indexes, and V5 Post index) are online. It does not scan Friendship or Post graph data. Otherwise it returns HTTP 503 with a sanitized reason; it does not expose credentials or driver diagnostics. Verify V5 readiness against the explicitly selected `isn-test` after migration; never use readiness as authorization to mutate `isn-dev`.
- API startup never applies migrations. Run an explicit migration command after reviewing its target and status.

## Verified runtime evidence (2026-10-14)

Historical pre-ISN-A evidence verified Driver 6.2.0 against Neo4j Server 2026.09.0 Enterprise, the restricted test identity and `isn-dev` denial, and V1–V3 on both approved databases. The ISN-A Build checklist records the separately gated V4 apply/verification on `isn-dev` and `isn-test`, with V1–V3 checksums unchanged. Its Step 5 record and command output recorded passing restricted `isn-test` V4 preflight, serial Neo4j regressions, and Friendship real-stack acceptance. Those are historical run results; this document does not treat them as proof of the current database state.

The first Step 6 recheck was refused while Neo4j Desktop was stopped, before identity verification. After the Owner confirmed startup, repeated `npm run test:neo4j:friendship-acceptance-preflight` gates passed against restricted `isn-test`: expected database ID, `isn_test_runner` roles and effective privileges, V1–V4 checksums/catalog, 11 constraints, 16 ONLINE indexes, valid graph invariants, denied `isn-dev`, free acceptance ports, no unknown fixture manifests and no active test transactions. The focused Friendship writer, Friendship browser acceptance, and targeted Authentication/Profile regressions then ran with exact owned-fixture cleanup. The final read-only gate confirmed the original baseline (0 users, 0 sessions, 2 auth events, 0 pairs, 0 friendship edges) and unchanged preservation fingerprint `d5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437`. No migration, provisioning, role/permission change, or `isn-dev` application-data read occurred. This is current `isn-test` evidence; do not infer a new read of `isn-dev` data. No retention/pruning is configured; real-user event retention remains pending data-governance approval.

## Verified runtime evidence (2026-10-15, ISN-C continuation)

After the Owner explicitly approved the exclusive `isn-test` write window, the guarded Post-only provisioner applied the reviewed 14-command grant delta and the explicit migration command applied V5. Readiness verified V1–V5, 12 constraints and 18 ONLINE indexes for database ID `336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786`, using only `isn_test_runner`; the restricted identity's `isn-dev` denial was verified. The serial real Posts suite passed with 9 synthetic users and 29 owned Posts, covering visibility, friendship state, pagination, concurrent mutations, rollback, graph invariants and exact cleanup. PROFILE used a `NodeIndexSeek` on `Post(authorId, createdAt, id)` (27 database hits, 22 rows). Final restricted read-only comparison matched fingerprint `0e86ee7f2c92de4a578ffcbe82da05ce5a742ffaa139864cf1507619dfce8bd4` and counts `0 users / 0 sessions / 2 auth events / 0 pairs / 0 friendships / 0 Posts / 0 AUTHORED`. The Build made no `isn-dev` application-data changes; no broader Scenario Testing or production-readiness claim follows from this evidence.

Official references: [Driver compatibility](https://neo4j.com/docs/javascript-manual/current/install/), [database selection and queries](https://neo4j.com/docs/javascript-manual/current/query-simple/), [built-in procedures including `db.info()`](https://neo4j.com/docs/operations-manual/current/procedures/built-in-procedures/), [user management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-users/), [role management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-roles/), [database privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/database-administration/), and [graph write privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/privileges-writes/).
