# Weylume Social Demo Data v2

**DEV/LOCAL ONLY — NEVER USE IN PRODUCTION.** These public credentials are for a loopback Weylume instance with `NODE_ENV=development` and the `isn-dev` database.

| Name | Email | Role |
| --- | --- | --- |
| Weylume Admin | `admin123@gmail.com` | ADMIN |
| An Nguyễn | `annguyen482@gmail.com` | USER |
| Bình Trần | `binhtran731@gmail.com` | USER |
| Chi Lê | `chile259@gmail.com` | USER |
| Dũng Phạm | `dungpham604@gmail.com` | USER |
| Giang Võ | `giangvo815@gmail.com` | USER |
| Hà Đặng | `hadang367@gmail.com` | USER |
| Huy Bùi | `huybui923@gmail.com` | USER |
| Lan Đỗ | `lando146@gmail.com` | USER |
| Minh Hồ | `minhho578@gmail.com` | USER |
| Ngọc Phan | `ngocphan294@gmail.com` | USER |
| Quân Vũ | `quanvu860@gmail.com` | USER |
| Thảo Đinh | `thaodinh413@gmail.com` | USER |

All 13 accounts use the password `Weylume-Local-Test-2026!`. The seeder hashes passwords and provisions the administrator in its database transaction. Demo sign-in and session restoration require a loopback API host, web origin and Neo4j endpoint. Treat the addresses as demo identifiers and avoid sending mail to them.

## Seed an existing development database

Run from the root of the V8 feature worktree. Set up the ignored `apps/api/.env` using `apps/api/.env.example`. Set `NODE_ENV=development`, `NEO4J_DATABASE=isn-dev`, a loopback `NEO4J_URI` and local database credentials. Leave activity capture disabled. In PowerShell, set `$env:ISN_API_ENV_FILE` to the absolute path of an existing ignored API env file to reuse it across worktrees. The seeder can run before the API authentication key files are generated.

```powershell
npm run social-demo:preflight
npm run social-demo:apply
```

The preflight checks the target, the V8 migration history and catalog, and the demo roster. Follow the [Neo4j operations guide](development/neo4j-operations.md#v8-alert-reviews-rollout) if the existing database needs V8. A fresh demo roster starts with 12 Vietnamese member profiles, 18 accepted friendships, 5 pending requests, 27 posts, 48 comments and 75 likes. Running `social-demo:apply` again against the exact owned v2 roster is a no-op. Stop if a reserved email is already in use or the ownership check fails.

## Upgrade a manifest-owned v1 dataset

Use a quiescent Owner-approved window with a verified consistent backup and the original private `~/.weylume/social-demo-data/owner-manifest.json`. Match the manifest to the live database ID and all 12 v1 UUIDs. Run the read-only inspection, check the result, and then run the upgrade command once V8 is verified.

```powershell
npm run social-demo:inspect-v1
npm run social-demo:upgrade-v1
npm run social-demo:preflight
```

The legacy inspector checks the fixture boundary. If the graph differs, stop and establish ownership with the Owner before rerunning. For the specifically reviewed `isn-dev` operation with 50 comments, use `-- --expected-comments=50` on both the inspection and upgrade commands. This preserves all 50 comments, including the two additional comments the Owner approved retaining.

The upgrade rotates the verified v1 accounts to their v2 emails and shared password, revokes their existing sessions, and adds the demo administrator. Member UUIDs, profiles, social relationships, content, audit records and the legacy manifest are retained. Keep the manifest, backup, keys and database credentials private.

## Open Weylume

Start the [V8 worktree launcher](development/admin-preview.md). The defaults below use its local web port.

- [Sign in](http://127.0.0.1:5173/dang-nhap) with a seeded account.
- As a member, open [Bạn bè → Gợi ý kết bạn](http://127.0.0.1:5173/ban-be/goi-y) to see Weylume accounts ranked by mutual friends and send an invitation.
- As an administrator, open [Quản trị](http://127.0.0.1:5173/quan-tri) for statistics, moderation, alerts and synthetic ML research. Configure the [local synthetic ML bundle](api/ml-demo.md#local-bundle) for the research and alerts pages.
