# Implemented standalone graph ingestion

## Scope and status

The standalone `data-pipeline/` task implements a file-based PySpark pipeline for a locally supplied **undirected edge list**:

```text
manifest-pinned source → Bronze Parquet → Silver edges/nodes + quarantine/metrics → Gold graph contracts
```

This is synthetic Build verification, not real SNAP acceptance. SNAP rights and trusted source pins remain unresolved; the committed SNAP candidate manifest therefore fails closed. No source acquisition, API/Neo4j access, application identity mapping, generated activity, ML feature engineering, model training, score serving, or streaming system is implemented. The pipeline is intentionally isolated from the application and both Neo4j databases.

## Runtime and launcher

`scripts/data-pipeline.ps1` exposes `doctor`, `prepare-source`, `run`, `test-unit`, and `test-integration`; usage and invocation limits are in [`data-pipeline/README.md`](../../data-pipeline/README.md). The verified runtime is Docker Desktop Linux/amd64, Python 3.12.15, PySpark 3.5.9, Py4J 0.10.9.7 and OpenJDK 17.0.20.1+1. Spark is `local[2]`, Snappy remains the Parquet codec, container networking is disabled, and the source/repository mounts are read-only. The Snappy native library uses only `/run/isn-etl-snappy`, a dedicated executable tmpfs with mode 0700 and UID/GID 10001; `/tmp` is not remounted executable.

The launcher refuses a missing image rather than pulling/building or changing system runtimes. Its `doctor` runs Spark startup, an actual Python worker, Snappy native loading, Parquet footer/read-back/schema/data/null checks, and Spark shutdown.

## Stage outputs

- `bronze/raw_edges` preserves every logical source line, including blank/comment/malformed lines, line order/number, source filename, raw text without the line terminator and deterministic record ID. `bronze/source_metadata` records both hashes and byte sizes, graph semantics, source citation/rights/acquisition metadata, schema/transform/policy versions, run ID and ingest time.
- `silver/nodes` contains only endpoints observed in accepted edges. `silver/edges` contains sorted numeric endpoint pairs and source occurrence counts. Reverse and repeated source edges collapse into one undirected edge. `silver/quarantine` retains malformed candidate rows and one deterministic reason code. Blank and comment rows are counted separately. `silver/quality_metrics` records Bronze/Silver/Gold counts.
- `gold/nodes` assigns `<dataset_id>:<canonical-decimal-source-id>` analytical IDs. `gold/edges` uses those namespaced IDs in numeric source-ID order. These are graph interchange contracts, not ML features or application User IDs.

Exact field names/types and policies are in [`parquet-contracts.md`](parquet-contracts.md). SHA validation and manifest identity rules are in [`dataset-provenance.md`](dataset-provenance.md).

## Validation, identity and reuse

The source/run identities derive from pinned source bytes and manifest transform-policy versions/configuration. Source records use SHA-256 of source version, filename and line number. Run metadata separately fingerprints Python/PySpark/Py4J/Spark/Java, ETL source files and dependency lock files; existing output is not silently reused if those fingerprints differ.

Before a run is marked complete, the pipeline reads every Parquet output back and checks exact column names/order, logical types and metadata, actual null values for required fields, row count and an order-independent-of-file-layout logical SHA-256. It validates accounting identities, deduplicated canonical edges, positive occurrence counts, observed-node endpoint integrity, Gold namespace/order, and equality of Silver/Gold counts. The registered `part-*.parquet` inventory is also compared with every non-hidden `.parquet` file Spark can discover recursively; an unexpected visible Parquet file, including one with a different filename pattern or outside a registered table directory, fails publication/reuse. Identical completed runs are revalidated before reuse; any partial or conflicting final destination fails without overwrite.

Completion uses a marker written last, not an atomic whole-folder commit. The run root stays reserved if a process fails during publication; readers must reject absent/invalid `_COMPLETE.json` or mismatched manifest/output checksums. No task or CLI cleanup sweeps incomplete runs. Windows/Docker Desktop bind-mount rename/durability behavior is not represented as a transactional guarantee.

## Verification boundary

`tests/fixtures/data_pipeline/` contains an original, checksummed synthetic edge list. `tests/unit/data_pipeline/` uses standard-library `unittest`; `tests/integration/data_pipeline/` starts real local Spark inside Docker and reads the actual Parquet outputs. These Build checks establish synthetic contracts only. They do not establish SNAP rights, source authenticity, SNAP counts, ML quality, production readiness, or the separately approved Step 5 acceptance.
