# Preview PR #16 on Windows

Install dependencies with `npm ci` in the V8 feature worktree. Prepare a local API env file and authentication keys using the [environment guide](setup.md). Start the approved Neo4j instance separately and verify the existing `isn-dev` database is on V8.

On the Owner's machine, run these commands in PowerShell.

```powershell
Set-Location 'D:\DoAn\BigData\isn-worktrees\user-recommendations-admin-rbac'
$env:ISN_API_ENV_FILE = 'D:\DoAn\BigData\intelligent-social-network\apps\api\.env'
.\scripts\start-dev.cmd
```

On another machine, substitute the V8 feature worktree and local API env file paths. If the API env file is already at `apps/api/.env` inside the feature worktree, the launcher can use it directly. The updated `start-dev.cmd` also accepts the target worktree path as its first argument. Relative auth key paths resolve from the selected API env file.

The launcher prints the Git root, branch and commit SHA and starts both servers from that worktree. It checks API readiness for `isn-dev` at V8 and validates the web proxy before opening the UI. For a reachable schema mismatch, it reports the expected and actual versions and stops startup. The launcher only checks readiness and leaves Git and database state intact.

Stop both servers with `.\scripts\stop-dev.cmd` from the same worktree. Both wrappers use the selected worktree's launcher, so start and stop share its supervisor identity. An occupied port causes startup to stop while the existing listener stays active.

If using different ports, configure the API env file and the worktree's optional `apps/web/.env` together. For API port 3300 and web port 5180, set `PORT=3300`, `AUTH_ISSUER=http://127.0.0.1:3300`, `AUTH_WEB_ORIGIN=http://127.0.0.1:5180`, `ISN_WEB_PORT=5180` and `API_PROXY_TARGET=http://127.0.0.1:3300`. Keep `NEO4J_DATABASE=isn-dev`.

Use the V8 feature worktree while PR #16 is in draft. The V7 checkout of `main` is incompatible with an `isn-dev` already at V8. See [demo sign-in and seed instructions](../social-demo-data.md).
