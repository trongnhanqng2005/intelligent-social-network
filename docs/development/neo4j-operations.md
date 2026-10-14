# Neo4j local operations

## Approved runtime and credentials

The project targets the Owner-provisioned Neo4j Desktop 2.2.1 / Server 2026.09.0 Enterprise instance at `neo4j://127.0.0.1:7687`, with existing databases `isn-dev` and `isn-test`. Do not install another DBMS, recreate either database, reset it, or seed application data.

- Development/API and one-time provisioning use `apps/api/.env` with `NEO4J_DATABASE=isn-dev` and `NEO4J_USERNAME` / `NEO4J_PASSWORD`.
- `npm run neo4j:provision-test` uses that administrator credential only for explicit user/role setup. It generates `isn_test_runner`'s password using Node's cryptographic random generator and writes it to ignored `apps/api/.env.test.local` (best-effort owner-only file permissions). It never prints the password. Keep the file local; do not put it in chat, shell arguments, logs, or source control.
- Real DB tests and test migrations load only `apps/api/.env.test.local`, set `NODE_ENV=test`, and require `NEO4J_DATABASE=isn-test`. They do not load development `.env` or pass development credentials. Configuration validates the exact test target.
- Browser/API contract tests use explicit non-routable dummy Neo4j settings and are not database evidence.

The provisioner checks the reserved username and role before acting. If they exist, it verifies the known local credential, account home/status/roles, and the exact role privilege set; it refuses to rotate a password or repair unexpected assignments/grants. Re-running after successful provisioning is safe. If setup is interrupted, inspect the user, role, privilege list, and ignored credential file before retrying; do not manually broaden the role.

The dedicated role is limited to `isn-test`: `ACCESS`, explicit `DENY ACCESS` on `isn-dev`, create/show constraints and new schema names, foundation metadata access, and property/label/relationship-scoped authentication and profile access. Before granting scoped privileges, the provisioner verifies `isn-test` identity and registers only the approved V1–V3 schema, Authentication, and profile label/property tokens. Neo4j activates fine-grained grants only for existing tokens; this step changes schema token metadata, not application data. The role is not granted `admin`, `architect`, or unrestricted graph privileges. Tests verify actual identity/roles and prove `isn-dev` access is denied.

## Explicit schema migrations

Migrations are defined in `apps/api/src/neo4j/neo4j-migrations.ts` as an ordered, versioned list. `V1 foundation-schema-marker` establishes and validates uniqueness constraints for the schema marker and migration history. `V2 authentication-schema` adds unique constraints for user ID/email, session ID/JWT ID, and auth event ID, plus range indexes for session expiry and event timestamp. `V3 user-profile-discovery` safely initializes existing users and adds the named TEXT index on `User.displayNameSearch`. V1/V2 definitions and checksums remain immutable. Friendship and Post migrations belong with separately approved increments; do not add them speculatively.

Neo4j constraint/index DDL is run as explicit schema statements, outside the graph transaction that updates migration metadata. The runner therefore:

1. verifies the selected database with `CALL db.info()`;
2. inspects named constraints and compares type, entity, label, and properties with the expected definitions before accepting them;
3. ensures the migration-history constraint, then records the SHA-256 definition checksum and `APPLYING` status;
4. executes the migration statements, writes the marker, verifies the resulting schema, and only then records `VERIFIED` and `verifiedAt`.

The history is stored in `ISNSchemaMigration` nodes with version, name, checksum, `appliedAt`, status, and verification time. Reapplying a verified version is a no-op. A changed applied definition, unexpected same-name constraint, wrong database, or mismatched history is reported as drift; migrations are never silently run by API startup. There is no automatic rollback or database reset.

If a process fails after an `APPLYING` record or after a DDL statement, the graph transaction cannot undo already committed schema DDL. Check the explicit target, migration history, and actual constraint definitions using `npm run neo4j:status:test` or `npm run neo4j:status:dev`. Resolve partial state through reviewed, narrowly scoped operations, then rerun the same unchanged migration. Never edit an applied migration; introduce a new ordered version in the appropriate future increment. If the initial history constraint failed before a history record could be committed, inspect the catalog and rerun only after confirming no conflicting definition.

## Commands

Run from the repository root:

```sh
npm run neo4j:provision-test # explicit admin-only provisioning
npm run neo4j:migrate:dev    # apply/verify schema on isn-dev
npm run neo4j:migrate:test   # apply/verify schema on isn-test
npm run neo4j:status:dev     # read-only dev migration status/verification
npm run neo4j:status:test   # read-only test migration status/verification
npm run test:neo4j:profile-preflight # read-only restricted isn-test acceptance gate
npm run test:neo4j           # real auth/profile integration; only owned synthetic records are cleaned
```

The dev and test commands load their respective local env files and verify the server-reported database identity before writes. `npm run test:neo4j` verifies the cumulative schema and uses synthetic, uniquely identified authentication/profile fixtures. It proves transactional rollback, duplicate-email races, session creation/restoration/revocation/replay denial, profile persistence/privacy/search/keyset pagination, and exactly-one-winner concurrent profile updates. Cleanup is limited to records linked to generated fixture UUIDs after positive `isn-test` identity verification; it never deletes unrelated records or accesses `isn-dev` data.

`npm run test:neo4j:profile-preflight` is a separate read-only acceptance gate for the restricted `isn-test` identity, migration history/checksums, exact schema catalog, profile invariants and baseline counts; it does not migrate or create fixtures. The full `npm run test:neo4j` command also includes `schema.test.mjs`, which invokes `migrations.migrate()` twice and therefore has schema/history write capability. Preserve that migration/idempotency coverage, but do not run the full command against a live acceptance database without separate authorization. See the [profile/discovery acceptance record](../../tests/e2e/user-profile-discovery-acceptance.md).

## Readiness and health

- `GET /health` remains process liveness: HTTP 200 and exactly `{"status":"ok"}`, independent of Neo4j.
- `GET /ready` returns HTTP 200 only when Neo4j is reachable, the selected database identity matches, current migration history/checksums are verified, and required constraint/index definitions including the V3 TEXT index are online. Otherwise it returns HTTP 503 with a sanitized reason; it does not expose credentials or driver diagnostics.
- API startup never applies migrations. Run an explicit migration command after reviewing its target and status.

## Verified runtime evidence (2026-10-14)

The installed official Driver 6.2.0 authenticated to Neo4j Server 2026.09.0 Enterprise. The restricted test account's roles are exactly `PUBLIC` and `isn_test_runner_role`, its `isn-test` identity is verified, and `isn-dev` access is denied. Cumulative V1/V2/V3 migrations are verified on both `isn-dev` and `isn-test`; V1/V2 checksums remain unchanged, V3 checksum is `d21cf5f1f660cde4199a5283571becd87d00f9e606cc30101a489625fca417ee`, and the V3 TEXT index is ONLINE. Repeat migration commands were no-ops. Real Neo4j integration verifies owned auth/profile fixtures, profile field privacy, name search, UUID keyset pagination, and exactly-one-winner concurrent profile version updates, along with authentication rollback/races/session revocation and replay denial. The test database retained its two pre-existing auth events after fixture cleanup. No retention/pruning is configured; real-user event retention remains pending data-governance approval.

Official references: [Driver compatibility](https://neo4j.com/docs/javascript-manual/current/install/), [database selection and queries](https://neo4j.com/docs/javascript-manual/current/query-simple/), [built-in procedures including `db.info()`](https://neo4j.com/docs/operations-manual/current/procedures/built-in-procedures/), [user management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-users/), [role management](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-roles/), [database privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/database-administration/), and [graph write privileges](https://neo4j.com/docs/operations-manual/current/authentication-authorization/privileges-writes/).
