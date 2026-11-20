# Synthetic ML demo API

Both endpoints require the existing `AuthSessionGuard` session cookie. Responses use `Cache-Control: no-store`; an absent/invalid cookie is `401`. The default is disabled: without a valid private `ML_DEMO_BUNDLE_PATH`, an authenticated request receives the same generic `503`. No database, model inference, or artifact path supplied by HTTP is involved.

`GET /ml-demo/recommendations` returns recommendations and `canViewAlerts`. Only exact, canonical application user UUIDs in server-side `ML_DEMO_ALERT_REVIEWER_IDS` (comma-separated; empty/unset denies all) receive `canViewAlerts: true`. `GET /ml-demo/anomalies` is independently protected and returns `403` to other authenticated users before the snapshot is read. This capability is server-only; it is not an application role.

Both responses are allowlist projections, not account or relationship records. The loader accepts only bounded schema-version-1 synthetic bundles, exact field sets, approved synthetic namespaces, finite bounded scores, UTC timestamps, contiguous ranks, unique pairs, threshold-consistent alerts, and count bounds. Malformed, missing, or unreadable bundles fail closed without exposing paths or parse details.

## Prepare a local demo

The API reads the optional ML demo settings from `apps/api/.env` at startup. From the repository root in PowerShell, use a Python environment and artifact directory outside the repository. Install the pinned dependencies before running the converter:

```powershell
$venv = 'C:\path\to\friend-rec-venv'
$artifacts = 'C:\path\to\ml-artifacts'
$out = Join-Path $env:LOCALAPPDATA 'Weylume\private\ml-demo-v1.json'
python -m venv $venv
& "$venv\Scripts\python.exe" -m pip install -r friend_recommendation\requirements.txt
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
& "$venv\Scripts\python.exe" scripts\prepare-ml-demo.py `
  --recommendations "$artifacts\recommendations.parquet" `
  --scores "$artifacts\scores.parquet" `
  --alerts "$artifacts\alerts.parquet" `
  --metrics "$artifacts\metrics.json" `
  --output $out
```

For reproducibility, keep two copies of the supplied artifacts outside the repository and verify that each corresponding file is bit-identical (for example, compare SHA-256 hashes) before conversion. The established artifact set has independently verified parity of 480 recommendations, 64 evaluated scores, and 39 alerts. The converter rejects schema/provenance mismatches, alerts that are not the exact `isAlert=true` score projection, inconsistent metrics, and existing output paths. It writes atomically and does not overwrite. In `apps/api/.env`, set `ML_DEMO_BUNDLE_PATH` to the resulting file and `ML_DEMO_ALERT_REVIEWER_IDS` to the exact UUIDs of explicitly approved existing application users. Separate multiple UUIDs with commas. Keep the bundle outside the repository and restart the API after updating the settings.

## Run and verify

Start the API and web app from the repository root in separate terminals using the project's normal environment configuration:

```powershell
npm run dev:api
npm run dev:web
```

Open `/nghien-cuu`. To configure a reviewer, sign in as an approved existing user and read the exact `user.id` from the authenticated `/api/auth/session` response. Use that UUID in the server-side list.

Run browser end-to-end checks on desktop, tablet, and mobile viewports. Verify authenticated recommendations and reviewer alerts, plus `401` for missing/invalid sessions, `403` for a non-reviewer, and `503` for missing/invalid demo configuration; all responses must be `no-store`. Also verify retry after an unavailable response and a valid empty result. Session fixtures should use only the repository's in-memory auth-repository fixture; do not perform database I/O.

Run converter checks with the pinned interpreter:

```powershell
& 'C:\path\to\friend-rec-venv\Scripts\python.exe' tests\unit\ml-demo-converter.test.py
npm run test:api -- --runInBand
npm run test:web -- --run
npm run typecheck
```

Never point this feature at real account data. See [frontend design](../design/frontend-design-system.md) and [roadmap](../roadmap.md).
