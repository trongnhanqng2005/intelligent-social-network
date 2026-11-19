# Owner-approved Social Demo Data v1

The seed command is intentionally fail-closed. Codex performed a read-only live check: `isn-dev` reported V4/incomplete rather than current V7, and inventory counts were zero; no database writes were performed. Commands run on another machine need `apps/api/.env` and `NODE_ENV=development`. The command does not run migrations, grant privileges, or target `isn-test`.

## Readiness and later authorization

Do not apply until the owner separately authorizes necessary migration/readiness work and the actual database reports exact current V7 checksums/catalog. This code does not migrate or repair schema.

The preflight requires `NODE_ENV=development`, configured and server-reported `isn-dev`, a loopback Neo4j URI, `ACTIVITY_CAPTURE_ENABLED` off, and `Neo4jMigrationService.getStatus()` current V7. It reads the database for identity, migration status, and inventory. It does not create or read a local ownership manifest. It uses `Neo4jOperationsModule`; API signing keys are not required. When target identity is verified it prints sanitized inventory and reports the exact readiness failure; mismatched real identity withholds inventory.

## Local ownership manifest

Only `--apply`, after read-only target/schema/inventory checks pass and exact reserved emails are absent, may create `~/.weylume/social-demo-data/owner-manifest.json` without clobbering an existing file. A private temporary file is fully written and closed before atomic publication; permissions are owner-only where supported. It records dataset/database identity, twelve fixture UUIDs and `@example.test` emails, and distinct randomly generated passwords. Keep it private; never copy it into source control or share its passwords. If a valid manifest already exists, only the exact complete ID/email roster is a no-op; a partial or mismatched roster is refused. Existing improvements are never reset.

The fixture creates 12 Vietnamese profiles, 18 accepted friendships, 5 pending requests, 27 posts (member/friends visibility), 48 contextual comments, and 75 likes. Creation is scoped to one explicit Neo4j transaction through the domain repositories. Activity capture must remain disabled. Hashing/authentication and social mutations use application domain repositories/services; no migration is invoked.

## Commands

From repository root:

```sh
npm run social-demo:preflight
npm run social-demo:apply
```

Before applying, migration/readiness work must be independently authorized and the actual database must report exact current V7 checksums/catalog.

The preflight command is read-only with respect to database and manifest state; its npm script builds the API into local `apps/api/dist/` before running the preflight. The apply command applies only when every gate passes. Neither command runs migrations or targets `isn-test`. Offline tests do not prove behavior against Neo4j.
