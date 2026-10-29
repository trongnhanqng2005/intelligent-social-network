# Dataset provenance and run identity

## Manifest version 1

Every processed source must be accompanied by a UTF-8 JSON manifest. The supplied candidate at `data-pipeline/config/snap-facebook-combined.json` is intentionally unusable while rights, trusted hashes and byte sizes are unresolved; null pins are not values to fill automatically.

Required fields:

| Field | Contract |
|---|---|
| `manifest_version` | Integer `1`. |
| `dataset_id` | Lowercase safe identifier; also namespaces Gold analytical IDs/output directories. |
| `source_file` | Basename only; must match the supplied local file. |
| `source_format` | `plain` or `gzip`; original compressed bytes remain unchanged. |
| `graph_semantics` | `undirected_edge_list`; other graph semantics are unsupported. |
| `source_sha256`, `uncompressed_sha256` | Trusted lowercase SHA-256 pins for the exact source bytes and decoded content. Both required to process. |
| `source_bytes`, `content_bytes` | Pinned non-negative byte counts for the source and decoded content. Both required to process. |
| `citation` | Non-empty attribution. |
| `rights_status`, `rights_evidence` | `synthetic` requires evidence; external data requires `approved`, evidence and `source_url`. `unresolved` is rejected before the file is read. |
| `source_url`, `acquired_at` | Optional for synthetic input. Approved external data must record its source URL and timezone-aware ISO-8601 acquisition time. |
| `schema_version`, `transform_version`, `quality_policy_version` | Non-empty contract/version strings. |
| `expected_reference_counts` | Optional object; descriptive expectations only, never treated as measured output. |

The manifest does not self-approve rights. An Owner/authorized maintainer must establish evidence and explicitly provide a trusted checksum/size pin before an external source is eligible. The tool has no downloader and does not compute/accept a first-seen hash as a trust decision. It checks compressed hash and length before decoding, then decoded hash and length, strict UTF-8 and non-empty content. Gzip corruption, mismatches, absent files, unsafe names and unresolved rights fail before Spark starts.

## Deterministic identities

- `source_version` is the SHA-256 of the exact source file bytes (compressed bytes for gzip input).
- `record_id` is SHA-256 of `source_version`, source basename and one-based logical line number separated by NUL bytes.
- `run_id` is SHA-256 of canonical JSON containing dataset ID, source version, schema/transform/quality-policy versions and relevant run configuration. The run manifest identity additionally records citation, rights, acquisition and expected-reference provenance, so a metadata change cannot be reused under the same identity hash.
- Runtime provenance separately records Python, PySpark, Py4J, Spark, Java/java.home, the sorted package-source SHA-256 and the project/dependency-lock SHA-256. A completed run is not reused if that provenance differs.

`ingested_at` and manifest `created_at` are observational timestamps, not identity inputs. Consequently Bronze metadata/timestamps and their logical checksum vary between independent invocations; normalized Silver/Gold logical rows are expected to reproduce. Parquet physical bytes, file names, partition order and compression block layout are not reproducibility contracts.

## Completion manifest

`_RUN_MANIFEST.json` contains source/run/runtime provenance, quality metrics, explicit schemas, read-back schema metadata, row counts, sorted logical-row SHA-256 digests and per-file size/SHA-256 records for each Parquet table. Before publication, the runner checks every table footer, performs a Spark read-back, validates required values, graph integrity and metric accounting, then records the data-file inventory. `_COMPLETE.json`, written last, contains the run ID and SHA-256 of the exact run-manifest bytes. Reuse verifies both marker and manifest, runtime/source identity, the exact Parquet data-file inventory and each recorded size/hash. A missing marker, checksum mismatch, changed schema/data file, incomplete final directory or unexpected identity is not a reusable run. Failed staging/final locations are retained for diagnosis; no broad or automatic cleanup occurs.

The manifest/marker detects interruption and accidental changes, not malicious replacement by an actor able to rewrite both files. Publication on a Windows host through Docker Desktop bind mounts is not claimed to be an atomic whole-directory transaction; consumers must honor the completion protocol.
