# Weylume Anomaly Detection v1 — offline academic MVP

Synthetic-only, offline research tooling. It has no application, API, Neo4j, SNAP, or real-user integration. The generator creates UUID-shaped event IDs, `synthetic-` actor/target IDs, UTC times, separate label-free feature inputs (`events.jsonl`, `anchors.jsonl`), and a separate `labels.jsonl`. It emits 96 train-normal actors and 64 actors in each validation/test cohort. Scenarios have seeded ordinary variation, friendship/content bursts, failed logins, and abrupt activity shifts at varied intensities. Actors are disjoint; cohort anchor blocks are chronological and separated by 48 hours. Each actor has exactly one anchor, including users with no event history.

Event names and fields follow [Activity Logging v1](../docs/big-data/activity-logging.md): `eventId`, `schemaVersion`, `eventType`, `occurredAt`, `source`, `actorId`, `targetUserId`. The projection's authentication allowlist is only `AUTH_REGISTERED`, `AUTH_LOGIN_SUCCEEDED`, and `AUTH_LOGOUT`; `SYNTHETIC_LOGIN_FAILED` is a synthetic-only scenario, not an existing research-projection event and must never be read as real Activity Logging data.

## Reproduce

Use Windows PowerShell 7 with Docker in Linux-container mode, and an external host venv installed from the pinned `friend_recommendation/requirements.txt`. Keep all artifact directories outside Git and choose new output directories for every invocation. Set `$artifacts` to an absolute path outside the checkout.

```powershell
$artifacts = 'D:/path/to/external-artifacts'
$venv = Join-Path $artifacts 'friend-rec-venv'
$python = Join-Path $venv 'Scripts/python.exe'
$repo = (Resolve-Path '.').Path
$requirements = Join-Path $repo 'friend_recommendation/requirements.txt'
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
py -3.12 -m venv $venv
& $python -m pip install -r $requirements
$data = Join-Path $artifacts ('weylume-anomaly-' + [Guid]::NewGuid().ToString('N'))
& $python -m anomaly_detection.workflow generate --output-dir "$data/source"
```

The `features` command accepts only event and anchor files—never labels. Spark requires a preflight of at least 2.25 GiB free node RAM. The following is the feature-launch command using the existing pinned Linux/amd64 image and resource/network/filesystem limits; replace `$data` only with an absolute artifact path. It does not modify or use a different launcher.

```powershell
New-Item -ItemType Directory -Path "$data/features-parent" | Out-Null
if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB -lt 2.25) {
  throw 'Spark requires at least 2.25 GiB available Windows RAM.'
}
docker run --rm --platform linux/amd64 --cpus=2 --memory=1536m --memory-swap=1536m `
  --pids-limit=256 --network none --hostname isn-etl --add-host isn-etl:127.0.0.1 `
  --read-only --user 10001:10001 --workdir /workspace `
  --env PYTHONPATH=/workspace --env PYTHONDONTWRITEBYTECODE=1 --env TZ=UTC --env PYSPARK_PYTHON=/opt/venv/bin/python `
  --env PYSPARK_DRIVER_PYTHON=/opt/venv/bin/python `
  --env 'PYSPARK_SUBMIT_ARGS=--master local[2] --driver-memory 512m pyspark-shell' `
  --env JAVA_TOOL_OPTIONS='-Dorg.xerial.snappy.tempdir=/run/isn-etl-snappy -XX:ActiveProcessorCount=2' `
  --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 `
  --tmpfs /run/isn-etl-snappy:rw,exec,nosuid,nodev,size=64m,mode=0700,uid=10001,gid=10001 `
  --mount "type=bind,src=$repo,dst=/workspace,readonly" `
  --mount "type=bind,src=$((Resolve-Path "$data/source/events.jsonl").Path),dst=/inputs/events.jsonl,readonly" `
  --mount "type=bind,src=$((Resolve-Path "$data/source/anchors.jsonl").Path),dst=/inputs/anchors.jsonl,readonly" `
  --mount "type=bind,src=$((Resolve-Path "$data/features-parent").Path),dst=/output" `
  --entrypoint python sha256:d83be3bc743e53f3e53443c2ee380ed0ab5356098db22caf29d54d9665554f21 `
  -m anomaly_detection.workflow features --events /inputs/events.jsonl `
   --anchors /inputs/anchors.jsonl --output-dir /output/features
```

The host repository is mounted read-only at `/workspace`; mount individual event and anchor files read-only under `/inputs` (never mount labels), and mount an existing host staging parent at `/output`. `/output/features` must be a new child. Spark writes Parquet directly and requires no PyArrow; sklearn/numpy are host-evaluation dependencies only. Do not write generated Spark temporary data outside the existing tmpfs locations. After Spark succeeds:

```powershell
& $python -m anomaly_detection.workflow evaluate --features "$data/features-parent/features/features.parquet" `
  --labels "$data/source/labels.jsonl" --output-dir "$data/evaluation"
```

Each command rejects an existing output directory, writes to an owned sibling staging directory, and publishes by same-filesystem rename only on success. Failed invocations publish no partial output. The Spark launch was exercised with the 2-CPU, 1536 MiB memory/swap, 256 PID, network-none, read-only image, 512 MiB driver, and tmpfs limits shown above. It mounted the checkout read-only plus exactly two read-only input files and a dedicated writable features-parent outside the checkout. Pre-launch free RAM was 3.406 GiB and 3.358 GiB on the two runs; require at least 2.25 GiB immediately before launch.

## Method and limits

Features are causal UTC `[t-24h,t)` and `[t-1h,t)` event counts by event family and failed logins, distinct targets in each window, and recent activity relative to the preceding 23-hour average. A numeric allowlist and finite-value check gate model input. The host evaluator validates explicit schemas, synthetic identity, exact actor/time feature-label join, and disjoint cohorts. A seeded 200-tree IsolationForest (seed `20261119`) fits only train normals. Its anomaly score is the negated sklearn `decision_function`, so larger means more unusual. Validation F1 selects a threshold; ties prefer lower FPR and then the higher threshold. The threshold is frozen before test evaluation.

`scores.parquet` contains the full test cohort and `alerts.parquet` is its exact `isAlert=true` filter. Both have only `actorId`, UTC `evaluatedAt`, finite `anomalyScore`, `isAlert`, and `modelVersion`; labels and scenarios are not present. `metrics.json` reports validation and test Precision, Recall, F1, FPR, alert count/rate, confusion counts, and sample counts.

### Verified synthetic experiment

Two independent actual Spark feature jobs followed by host model evaluations (`final-a` and `final-b`) produced identical feature and model results. The generated data had 1,646 events and 224 distinct actors, including 10 empty histories. Training used 96 normal actors; validation and test each had 35/29 and 38/26 anomaly/normal actors respectively. The 13 features and IsolationForest recipe above selected threshold `0.14241742859221085`. Validation: precision 97.22%, recall 100%, F1 98.59%, FPR 3.45%, 36/64 alerts. Test: precision 97.44%, recall 100%, F1 98.70%, FPR 3.85%, 39/64 alerts (60.94%); TP 38, FP 1, TN 25, FN 0. Simulated test recall was 7/7 abrupt activity, 9/9 content, 8/8 failed-login, and 14/14 friendship scenarios; one of 26 normals alerted.

These are clear seeded bursts in an engineered, high-anomaly-prevalence dataset from one synthetic seed. They do not establish operational accuracy or real-user validity. Synthetic failed-login events are experiment-only and are not part of the research projection's authentication allowlist.

All five host tests passed with the pinned dependencies. Run them with `& $python -m unittest discover -s tests/unit/anomaly_detection -v`. The Spark integration test passed in the pinned container at 3.875 GiB available RAM. To run it with the same resource settings, keep the checkout mount, omit the two inputs and the output mount, and replace the feature command with `-m unittest discover -s tests/integration/anomaly_detection -v`. It verifies inclusive window starts, exclusion at and after the anchor, failed-login counts and all-zero features for empty history.

Independent verification recomputed all 224 feature rows from the raw event times, trained on normal actors, and matched the validation threshold, test metrics and alerts. Inverting only the test labels changed the reported test metrics while preserving validation, threshold and prediction output. Overlapping 24-hour cohort histories were rejected before artifact publication.
