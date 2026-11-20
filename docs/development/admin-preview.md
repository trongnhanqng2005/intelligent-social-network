# Preview a PR worktree on Windows

The canonical launcher can run a separate Git worktree without switching branches
or changing roles or migrations. Install dependencies in the worktree first if
it does not share `node_modules`, and prepare its ignored/local development
environment and key files before launch.

Run the PR worktree’s launcher from that worktree. You can also pass a target root to the updated wrapper:

```cmd
scripts\start-dev.cmd D:\path\to\pr-worktree
```

The launcher prints the resolved root, branch, and commit SHA, and starts both
`npm run dev:api` and `npm run dev:web` from that root. Stop it using the
PR worktree's `scripts\stop-dev.cmd`. Both
wrappers use the selected checkout's launcher, so start and stop share its
supervisor identity. Launcher state, mutex, and Windows Job are scoped to that
root. It refuses ports already in use and never terminates unrelated listeners.

For a preview needing distinct API and Vite ports, prepare the worktree's local
environment values together: `PORT`, `AUTH_ISSUER`, `AUTH_WEB_ORIGIN`,
`ISN_WEB_PORT`, and `API_PROXY_TARGET` must agree. For example, API port 3300
and web port 5180 require issuer `http://127.0.0.1:3300`, web origin
`http://localhost:5180`, web port `5180`, and proxy target
`http://127.0.0.1:3300`. Keep the API's `NEO4J_DATABASE` set to `isn-dev`.

Prepare the worktree's ignored/local `apps/api/.env` and `apps/web/.env`
before launch. To use the canonical checkout's existing ignored API env file,
set `ISN_API_ENV_FILE` to its absolute path before launching; do not copy
credentials. The API ConfigModule and preflight both read the selected file.
Relative signing-key and CSRF paths resolve from the directory containing the selected API env file. Keep secrets and local key material out of commits.

Before opening the UI, the launcher waits for `/ready`. An incompatible
reachable database reports expected and actual schema versions and fails
startup; this is read-only and does not run migrations. No database, Git
branch, or role changes are performed by the launcher.
