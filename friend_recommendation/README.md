# Offline friend recommendation experiment

This is a synthetic-only, offline Python experiment. It reads actual Gold Parquet from a completed run of the existing ETL. It does not access SNAP, Neo4j, application data, or consumer UUIDs; IDs remain analytical Gold IDs.

Use the existing `scripts/data-pipeline.ps1` launcher and its documented `run` command to create a completed run. No Spark command is part of this Python workflow. On Windows, install `friend_recommendation/requirements.txt`; the pinned `tzdata` package is needed to decode UTC Parquet timestamps.

## Reproduce the offline run

Run from the repository root in PowerShell 7 with Docker Desktop in Linux mode and the verified local image. See the [Spark ETL setup](../data-pipeline/README.md) for image preparation. Choose fresh output directories and keep the 2.25 GiB host RAM gate before each Spark launch.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
py -3.12 -m venv .artifacts/friend-rec-venv
$python = ".artifacts/friend-rec-venv/Scripts/python.exe"
& $python -m pip install -r friend_recommendation/requirements.txt
$source = "datasets/friend-rec-source"
$runs = "datasets/friend-rec-runs"
$out = "datasets/friend-rec-evaluation"

& $python -m friend_recommendation.workflow generate --output-dir $source
if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB -lt 2.25) {
    throw "Spark requires at least 2.25 GiB available Windows RAM."
}
./scripts/data-pipeline.ps1 run `
  -Source "$source/synthetic-edges.txt" `
  -Manifest "$source/manifest.json" `
  -OutputRoot $runs `
  -Image "sha256:d83be3bc743e53f3e53443c2ee380ed0ab5356098db22caf29d54d9665554f21"
$run = Get-ChildItem "$runs/synthetic-friend-rec-v1/runs" -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
& $python -m friend_recommendation.workflow evaluate --run-root $run --output-dir $out
```

Both `generate --output-dir` and `evaluate --output-dir` require a fresh output directory. Each writes its artifacts in a temporary payload under the target's parent and publishes that payload with a same-filesystem rename only after all writes succeed. Existing destinations (including dangling symlinks) are rejected; failed writes leave no published output and their invocation-owned temporary directory is cleaned up.

`generate` writes `synthetic-edges.txt` and the existing ETL `manifest.json` format, with exact LF-terminated source bytes pinned by SHA-256 and byte count. Its seeded graph has connected community rings, heterogeneous within-community edges, hubs, and between-community bridges. All manifest version fields are `1.0.0`, and provenance declares synthetic rights only.

`evaluate` requires a completed run containing `_COMPLETE.json`, `_RUN_MANIFEST.json`, `gold/nodes`, and `gold/edges`. It verifies the completion-marker hash/identity relationship, synthetic-only provenance, registered schema names/types, row count, exact reader-visible Parquet inventory (including rejection of unexpected visible `.parquet` files), listed file sizes/hashes, actual Parquet schema, the complete Gold node catalog and provenance, numeric canonical unique edge order, and endpoint membership. Output directory must not already exist. Metrics persist the source SHA-256, ETL run ID, and node/edge counts.

Nine focused tests cover feature formulas, ranking, Gold integrity, and output preservation and retry. Run them with the dependency check:

```powershell
& $python -m unittest discover -s tests/unit/friend_recommendation -v
& $python -m pip check
```

## Experiment

The seeded canonical partition is 70% observed edges, 10% labeled training positives, 10% validation positives, and the remainder test positives. Every feature—including features for labeled training positives—is computed only from the observed 70%. Three disjoint seeded complete-graph nonedge pools provide 1:1 training negatives and separate validation/test negatives; each evaluation pool includes every positive in its split.

Features are common neighbors, Jaccard, Adamic–Adar, resource allocation, symmetric degree sum, and degree product. Logistic Regression (`C=0.1, 1, 10`) is selected on validation macro Recall@10, then AP, with deterministic tie-breaking. Test is evaluated once alongside a common-neighbor baseline. Both report Precision@5/10 (fixed K denominator), Recall@5/10, ROC-AUC, AP, observed-node coverage (nodes incident to the 70% observed training graph), serving-source coverage (nodes with at least one eligible nonedge), and split counts. Pairwise metrics use canonical pairs; ranking includes both directions and macro-averages over positive source endpoints.

`metrics.json` includes split/audit hashes, sampling ratio, source hash/run ID, and graph counts. Metrics and model selection use only the observed adjacency; after metrics are frozen, `recommendations.parquet` scores eligible nonedges using the full Gold snapshot adjacency. It excludes self and every known full-snapshot edge and contains at most ten candidates per source, ordered by score then analytical candidate ID. Its schema is `sourceNodeId`, `candidateNodeId`, `rank`, `score`, `modelVersion`, `computedAt` (UTC). Repeated-run comparisons ignore `run_id` when it differs and exclude `computedAt` from ranked-row comparison.

## Recorded real-Gold experiment — 2026-11-19

The two pinned-image Spark runs and offline evaluations used the same generated synthetic source, SHA-256 `08783fa840a548ccf42eb096c896a08ca6ee3b64f036a99d5eeef89fb121f655`. Spark A used equivalent earlier metadata tags; Spark B used the final generator manifest `1.0.0`. Both produced 48 nodes and 126 edges, with matching six Silver/Gold logical hashes. Measured live Spark RAM was 2.270 GiB and 2.607 GiB. Evaluation used the final Gold run (`codex-b` metrics); its run ID is `38b02c5ffd0f5ea2acdef0659b6ff8a8df46744ca02b193a0646eb88988e7e69`. The A/B metrics matched after ignoring differing run IDs, and the ranked rows matched excluding computed timestamps.

| Test metric | Common Neighbors | Logistic Regression (selected C=1) |
|---|---:|---:|
| Precision@5 | 0.1524 | 0.1810 |
| Recall@5 | 0.5873 | 0.6746 |
| Precision@10 | 0.0810 | 0.1143 |
| Recall@10 | 0.6349 | 0.8651 |
| ROC-AUC | 0.6979 | 0.8289 |
| Average Precision | 0.1013 | 0.1572 |

The graph split was 88 observed, 12 train-positive, 12 validation-positive, and 14 test-positive edges. Negative pools were 12/495/495 (train/validation/test); the test contains 21 positive endpoints. Observed-node coverage was 47/48 (97.92%); serving-source coverage was 48/48 (100%). The evaluated test set contained 14 positives and 495 negatives. Serving produced 480 valid rows: ten eligible, ordered recommendations for each of 48 sources.

Validation selected C=1 under the predefined macro Recall@10 then AP rule. LR improved on CN on this single small, seeded synthetic graph; this is graph-specific evidence, not evidence of generalization or a quality guarantee. These offline metrics do not establish SNAP performance, real-user benefit, production readiness, or application integration. The experiment uses no SNAP, Neo4j, application data, or consumer UUIDs; anomaly modeling remains out of scope.
