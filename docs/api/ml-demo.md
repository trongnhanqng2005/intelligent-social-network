# Synthetic ML demo API

All ML demo endpoints require a valid session and the administrator role, via `AuthSessionGuard` followed by `AdminGuard`. Responses use `Cache-Control: no-store`. Unsafe review requests also require the existing CSRF protection and JSON content type. Alert review applies only to synthetic actor IDs and does not create or imply an identity for a real person.

`GET /ml-demo/recommendations` returns recommendations and keeps `canViewAlerts: true` for authorized users for UI compatibility. `GET /ml-demo/anomalies` returns the validated synthetic alert projection, a SHA-256 `snapshotId` of the exact validated raw bundle bytes, and `reviewedAt` (UTC timestamp string or `null`) for each alert. Review state is read from Neo4j on every request.

`PUT /ml-demo/anomalies/review` accepts `{ "snapshotId": "<64 lowercase hex>", "actorId": "synthetic-test-actor-001" }`. It accepts only an alert in the current snapshot; stale snapshot IDs receive `409`, and valid synthetic actor IDs that are not current alerts receive `404`. The write transaction rechecks the current database role and requires the verified V8 application marker and migration record; otherwise it fails closed. Repeating a review is idempotent and returns the persisted `reviewedAt` from that same transaction. The V8 schema adds a unique `MLAlertReview.reviewKey` constraint; migration is additive and an interrupted V8 migration requires manual inspection.

The loader accepts only bounded schema-version-1 synthetic bundles and rejects malformed, missing, or unreadable bundles with a generic `503`. No database data or model inference is used to generate these alerts.

## Local bundle

Configure `ML_DEMO_BUNDLE_PATH` to a private bundle produced by `scripts/prepare-ml-demo.py`. Keep the bundle outside the repository. `ML_DEMO_ALERT_REVIEWER_IDS` is no longer used; access is determined by the application administrator role.

Use the existing approved synthetic bundle when available. To rebuild it from the approved Parquet and metrics files, run the converter from the repository root with the pinned Python dependencies.

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

The verified demo bundle contains 480 recommendations, 64 evaluated actors, and 39 alerts. Compare source artifact hashes with the verified copies before rebuilding.

After V8 is verified and the approved ADMIN is available, start the [V8 worktree](../development/admin-preview.md). On `/ban-be/goi-y`, check that a regular member can open a profile and send an invitation. As the approved ADMIN, open `/quan-tri` and enter the research workspace. Mark a synthetic alert reviewed and confirm the timestamp after restarting. Use the same session after revoking the role to verify the API denies admin access.
