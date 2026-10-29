# Parquet contracts

All tables use explicit Spark schemas and Snappy compression. Required fields are declared non-null in the producer contract and checked for actual null values after read-back. Spark's Parquet reader normalizes field nullability to `true`; contract verification therefore compares exact names/order, logical data types and metadata, then checks row values/nulls rather than comparing the full `StructType` nullability bit-for-bit.

Every stage row carries `dataset_id:string` and `source_version:string` unless listed otherwise. `source_version` is the compressed/source-file SHA-256.

## Bronze

| Table | Fields (in order) |
|---|---|
| `bronze/raw_edges` | `dataset_id:string`, `source_version:string`, `source_file:string`, `line_number:long`, `record_id:string`, `raw_text:string`, `ingested_at:timestamp` |
| `bronze/source_metadata` | `dataset_id:string`, `source_version:string`, `source_file:string`, `source_format:string`, `graph_semantics:string`, `source_sha256:string`, `uncompressed_sha256:string`, `source_bytes:long`, `content_bytes:long`, `acquired_at:string?`, `source_url:string?`, `citation:string`, `rights_status:string`, `rights_evidence:string?`, `schema_version:string`, `transform_version:string`, `quality_policy_version:string`, `run_id:string`, `ingested_at:timestamp` |

`raw_text` preserves the logical line content without its LF/CRLF line terminator; blank, comment, valid and malformed lines are all retained. `line_number` is one-based and `record_id` is deterministic. `acquired_at` is nullable only for synthetic/not-yet-acquired sources; `source_url` and `rights_evidence` are nullable in the common schema.

## Silver

| Table | Fields (in order) |
|---|---|
| `silver/nodes` | `dataset_id:string`, `source_version:string`, `source_node_id:long` |
| `silver/edges` | `dataset_id:string`, `source_version:string`, `source_node_id_low:long`, `source_node_id_high:long`, `source_record_count:long` |
| `silver/quarantine` | `dataset_id:string`, `source_version:string`, `record_id:string`, `source_file:string`, `line_number:long`, `raw_text:string`, `reason_code:string` |
| `silver/quality_metrics` | `dataset_id:string`, `source_version:string`, `stage:string`, `metric_name:string`, `value:long` |

Parsing accepts exactly two ASCII unsigned-decimal identifiers in signed 64-bit range. Endpoints are canonical numeric `min/max`; self-loops are rejected. Reverse and repeated edge occurrences collapse to one pair and contribute to `source_record_count`. Only endpoints from accepted edges enter the node catalog; isolated nodes are not inferred.

Quarantine `reason_code` values are `INVALID_COLUMN_COUNT`, `INVALID_IDENTIFIER`, `IDENTIFIER_OUT_OF_RANGE` and `SELF_LOOP`. Blank and comment records are counted separately rather than quarantined. Metrics include Bronze total/blank/comment/candidate records; Silver quarantined records, valid occurrences, unique edges, duplicate excess and observed nodes; Gold node/edge counts. Enforced identities are:

```text
total = blank + comment + candidates
candidates = quarantined + valid occurrences
valid occurrences = unique edges + duplicate excess
Silver observed nodes = Gold nodes
Silver unique edges = Gold edges
```

## Gold

| Table | Fields (in order) |
|---|---|
| `gold/nodes` | `dataset_id:string`, `source_version:string`, `node_id:string`, `source_node_id:long` |
| `gold/edges` | `dataset_id:string`, `source_version:string`, `node_id_low:string`, `node_id_high:string` |

`node_id` is `<dataset_id>:<canonical decimal source_node_id>`. Edge endpoints follow numeric source-ID order, not lexical string order. Every edge endpoint must exist in the Gold node catalog. These are analytical source identities, never application User UUIDs. No features, weights, timestamps, application IDs or model labels are added.

## Logical verification

For each table, the run manifest records the declared schema JSON/hash, nullable read schema, row count, SHA-256 over Spark-JSON serialized rows sorted lexically by their serialized representation (one LF per row; an empty table hashes zero bytes), and each Parquet data file's name, byte size and SHA-256. The first read-back validates each table's footer and actual required-field nulls; a single recursive Spark read covers all output tables. This guarantees repeatability of logical rows, not physical Parquet bytes or timestamps across independent runs. Output rows are collected in the bounded local driver for this static-graph scope. On reuse, the completion marker/runtime identity, registered file sizes/hashes and exact set of reader-visible `.parquet` files are checked; Spark does not rescan unchanged table rows. See [provenance and completion](dataset-provenance.md) for reuse/marker validation.
