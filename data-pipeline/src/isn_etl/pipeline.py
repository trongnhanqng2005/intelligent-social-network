from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import py4j
import pyspark
from pyspark.sql import DataFrame, SparkSession, functions as F
from pyspark.sql.types import StructField, StructType

from isn_etl.bronze import create_bronze_frames
from isn_etl.gold import create_gold_frames
from isn_etl.provenance import (
    SourceValidationError,
    ValidatedSource,
    load_manifest,
    stable_run_id,
    validate_source,
)
from isn_etl.publication import (
    PublicationError,
    create_staging_directory,
    publish_staged_run,
    read_completed_run,
    write_run_manifest,
)
from isn_etl.schemas import (
    GOLD_EDGES_SCHEMA,
    GOLD_NODES_SCHEMA,
    QUARANTINE_SCHEMA,
    QUALITY_METRICS_SCHEMA,
    RAW_EDGE_SCHEMA,
    SILVER_EDGES_SCHEMA,
    SILVER_NODES_SCHEMA,
    SOURCE_METADATA_SCHEMA,
)
from isn_etl.silver import QualityAccountingError, transform_silver, validate_quality_accounting


class PipelineError(RuntimeError):
    """A validated ETL stage failed a graph or publication invariant."""


@dataclass(frozen=True)
class RunResult:
    path: Path
    run_id: str
    reused: bool
    run_manifest: dict[str, Any]


_TABLE_SCHEMAS: dict[str, StructType] = {
    "bronze/raw_edges": RAW_EDGE_SCHEMA,
    "bronze/source_metadata": SOURCE_METADATA_SCHEMA,
    "silver/nodes": SILVER_NODES_SCHEMA,
    "silver/edges": SILVER_EDGES_SCHEMA,
    "silver/quarantine": QUARANTINE_SCHEMA,
    "silver/quality_metrics": QUALITY_METRICS_SCHEMA,
    "gold/nodes": GOLD_NODES_SCHEMA,
    "gold/edges": GOLD_EDGES_SCHEMA,
}


def _canonical_sha256(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _file_set_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.name):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _code_and_lock_provenance() -> tuple[str, str]:
    package_dir = Path(__file__).resolve().parent
    project_dir = package_dir.parents[1]
    code_sha256 = _file_set_sha256(list(package_dir.glob("*.py")))
    lock_files = [
        project_dir / "pyproject.toml",
        project_dir / "requirements.lock",
        project_dir / "requirements-build.lock",
    ]
    dependency_lock_sha256 = _file_set_sha256(lock_files)
    return code_sha256, dependency_lock_sha256


def _validate_read_schema(actual: StructType, expected: StructType, path: str) -> None:
    actual_fields = actual.fields
    expected_fields = expected.fields
    if [field.name for field in actual_fields] != [field.name for field in expected_fields]:
        raise PipelineError(f"Parquet field names/order mismatch at {path}: {actual.json()}")
    if [field.dataType.json() for field in actual_fields] != [
        field.dataType.json() for field in expected_fields
    ]:
        raise PipelineError(f"Parquet logical types mismatch at {path}: {actual.json()}")
    if [field.metadata for field in actual_fields] != [field.metadata for field in expected_fields]:
        raise PipelineError(f"Parquet field metadata mismatch at {path}: {actual.json()}")


def _parquet_read_schema(schema: StructType) -> StructType:
    return StructType(
        [StructField(field.name, field.dataType, nullable=True, metadata=field.metadata) for field in schema.fields]
    )


def _combined_output_schema() -> StructType:
    fields: dict[str, StructField] = {}
    for schema in _TABLE_SCHEMAS.values():
        for field in schema.fields:
            existing = fields.get(field.name)
            if existing is not None and (
                existing.dataType.json() != field.dataType.json()
                or existing.metadata != field.metadata
            ):
                raise PipelineError(f"Output tables have incompatible shared field {field.name!r}")
            fields.setdefault(
                field.name,
                StructField(field.name, field.dataType, nullable=True, metadata=field.metadata),
            )
    return StructType(list(fields.values()))


def _write_parquet(frame: DataFrame, path: Path) -> None:
    frame.coalesce(1).write.mode("errorifexists").option("compression", "snappy").parquet(str(path))


def _validate_parquet_footers(
    spark: SparkSession,
    table_path: Path,
    schema: StructType,
    relative_path: str,
) -> None:
    jvm = spark.sparkContext._jvm
    hadoop_conf = spark.sparkContext._jsc.hadoopConfiguration()
    parquet_files = sorted(table_path.glob("part-*.parquet"))
    if not parquet_files:
        raise PipelineError(f"Parquet output contains no data files: {relative_path}")
    for parquet_file in parquet_files:
        footer = jvm.org.apache.parquet.hadoop.ParquetFileReader.readFooter(
            hadoop_conf,
            jvm.org.apache.hadoop.fs.Path(str(parquet_file)),
        )
        metadata = footer.getFileMetaData().getKeyValueMetaData()
        schema_json = metadata.get("org.apache.spark.sql.parquet.row.metadata")
        if schema_json is None:
            raise PipelineError(f"Parquet Spark schema metadata is missing: {parquet_file}")
        actual = StructType.fromJson(json.loads(schema_json))
        _validate_read_schema(actual, schema, relative_path)
        for block in footer.getBlocks():
            for column in block.getColumns():
                codec = column.getCodec().name()
                if codec != "SNAPPY":
                    raise PipelineError(
                        f"Parquet compression must be SNAPPY at {relative_path}: found {codec}"
                    )


def _read_and_verify_outputs(
    spark: SparkSession,
    run_path: Path,
    manifest: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    outputs = manifest.get("outputs")
    if outputs is not None and (
        not isinstance(outputs, dict) or set(outputs) != set(_TABLE_SCHEMAS)
    ):
        raise PublicationError("Completed run does not list the exact required Parquet outputs")

    if outputs is not None:
        _verify_published_output_files(run_path, outputs)
        return outputs

    for relative_path, schema in _TABLE_SCHEMAS.items():
        output_path = run_path / relative_path
        if not output_path.is_dir():
            raise PublicationError(f"Completed output is missing: {relative_path}")
        try:
            _validate_parquet_footers(spark, output_path, schema, relative_path)
        except Exception as error:
            raise PublicationError(f"Cannot validate Parquet footer for {relative_path}: {error}") from error
    _validate_spark_visible_parquet_inventory(run_path)

    try:
        combined = (
            spark.read.schema(_combined_output_schema())
            .option("recursiveFileLookup", "true")
            .parquet(str(run_path))
        )
    except Exception as error:
        raise PublicationError(f"Cannot read staged Parquet outputs: {error}") from error

    input_path = F.input_file_name()
    table_conditions = {
        relative_path: input_path.contains(f"/{relative_path}/")
        for relative_path in _TABLE_SCHEMAS
    }
    table_expression = None
    logical_expression = None
    required_null_expression = None
    for relative_path, schema in _TABLE_SCHEMAS.items():
        condition = table_conditions[relative_path]
        logical_row = F.to_json(
            F.struct(*[F.col(name) for name in schema.fieldNames()]),
            options={"ignoreNullFields": "false"},
        )
        required_null = F.lit(False)
        for field in schema.fields:
            if not field.nullable:
                required_null = required_null | F.col(field.name).isNull()
        table_expression = (
            F.when(condition, F.lit(relative_path))
            if table_expression is None
            else table_expression.when(condition, F.lit(relative_path))
        )
        logical_expression = (
            F.when(condition, logical_row)
            if logical_expression is None
            else logical_expression.when(condition, logical_row)
        )
        required_null_expression = (
            F.when(condition, required_null)
            if required_null_expression is None
            else required_null_expression.when(condition, required_null)
        )

    assert table_expression is not None and logical_expression is not None
    assert required_null_expression is not None
    serialized_rows = (
        combined.select(
            table_expression.otherwise(F.lit(None)).alias("_table"),
            logical_expression.otherwise(F.lit(None)).alias("_logical_row"),
            required_null_expression.otherwise(F.lit(False)).alias("_has_required_null"),
            input_path.alias("_input_path"),
        )
        .where(F.col("_table").isNotNull())
        .collect()
    )
    output_rows: dict[str, list[str]] = {relative_path: [] for relative_path in _TABLE_SCHEMAS}
    for row in serialized_rows:
        if row._has_required_null:
            raise PublicationError(f"Required Parquet field contains nulls at {row._input_path}")
        output_rows[row._table].append(row._logical_row)

    verified_outputs: dict[str, dict[str, Any]] = {}
    for relative_path, schema in _TABLE_SCHEMAS.items():
        logical_rows = output_rows[relative_path]
        digest = hashlib.sha256()
        for logical_row in sorted(logical_rows):
            digest.update(logical_row.encode("utf-8"))
            digest.update(b"\n")
        actual = {
            "row_count": len(logical_rows),
            "schema": schema.jsonValue(),
            "read_schema": _parquet_read_schema(schema).jsonValue(),
            "schema_sha256": hashlib.sha256(schema.json().encode("utf-8")).hexdigest(),
            "logical_sha256": digest.hexdigest(),
            "files": _parquet_file_metadata(run_path / relative_path),
        }
        verified_outputs[relative_path] = actual

    try:
        _validate_graph_integrity_rows(output_rows)
        _validate_metric_accounting(output_rows["silver/quality_metrics"])
    except (QualityAccountingError, PipelineError) as error:
        raise PublicationError(f"Completed run failed graph/quality verification: {error}") from error
    return verified_outputs


def _validate_graph_integrity_rows(output_rows: dict[str, list[str]]) -> None:
    silver_nodes = [json.loads(row) for row in output_rows["silver/nodes"]]
    silver_edges = [json.loads(row) for row in output_rows["silver/edges"]]
    gold_nodes = [json.loads(row) for row in output_rows["gold/nodes"]]
    gold_edges = [json.loads(row) for row in output_rows["gold/edges"]]

    silver_node_ids = [row["source_node_id"] for row in silver_nodes]
    silver_node_set = set(silver_node_ids)
    if len(set(silver_node_ids)) != len(silver_node_ids):
        raise PipelineError("Silver observed-node catalog contains duplicate IDs")
    silver_pairs = [(row["source_node_id_low"], row["source_node_id_high"]) for row in silver_edges]
    if len(set(silver_pairs)) != len(silver_pairs):
        raise PipelineError("Silver undirected edge pairs are not unique")
    if any(low >= high for low, high in silver_pairs) or any(
        row["source_record_count"] <= 0 for row in silver_edges
    ):
        raise PipelineError("Silver edges are not canonical or have invalid occurrence counts")
    if any(endpoint not in silver_node_set for pair in silver_pairs for endpoint in pair):
        raise PipelineError("Silver edge endpoint is absent from the observed-node catalog")

    gold_node_ids = [row["node_id"] for row in gold_nodes]
    if len(set(gold_node_ids)) != len(gold_node_ids):
        raise PipelineError("Gold node identifiers must be unique")
    node_id_set = set(gold_node_ids)
    for row in gold_nodes:
        expected_id = f"{row['dataset_id']}:{row['source_node_id']}"
        if row["node_id"] != expected_id:
            raise PipelineError("Gold node IDs must preserve the dataset namespace and source ID")
    if node_id_set != {f"{row['dataset_id']}:{row['source_node_id']}" for row in silver_nodes}:
        raise PipelineError("Silver and Gold node identities disagree")

    gold_pairs = [
        (row["node_id_low"], row["node_id_high"], row["dataset_id"]) for row in gold_edges
    ]
    gold_edge_keys = [(low, high) for low, high, _ in gold_pairs]
    if len(set(gold_edge_keys)) != len(gold_edge_keys):
        raise PipelineError("Gold undirected edge pairs must be unique")
    for low, high, dataset_id in gold_pairs:
        if low.rsplit(":", 1)[0] != dataset_id or high.rsplit(":", 1)[0] != dataset_id:
            raise PipelineError("Gold edges must preserve dataset namespace and cannot loop")
        try:
            low_source_id = int(low.rsplit(":", 1)[1])
            high_source_id = int(high.rsplit(":", 1)[1])
            if low_source_id < 0 or low_source_id >= high_source_id:
                raise PipelineError("Gold edges must be ordered by numeric source ID")
        except (IndexError, ValueError) as error:
            raise PipelineError("Gold edge IDs must contain numeric source IDs") from error
        if low not in node_id_set or high not in node_id_set:
            raise PipelineError("Gold edge has a dangling node endpoint")


def _parquet_file_metadata(table_path: Path) -> dict[str, dict[str, Any]]:
    files = sorted(table_path.glob("part-*.parquet"))
    if not files:
        raise PublicationError(f"Parquet output contains no data files: {table_path}")
    metadata: dict[str, dict[str, Any]] = {}
    for path in files:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        metadata[path.name] = {"bytes": path.stat().st_size, "sha256": digest}
    return metadata


def _validate_spark_visible_parquet_inventory(run_path: Path) -> None:
    expected: set[str] = set()
    for relative_path in _TABLE_SCHEMAS:
        table_path = run_path / relative_path
        expected.update(
            f"{relative_path}/{path.name}"
            for path in table_path.glob("part-*.parquet")
            if path.is_file()
        )

    visible: set[str] = set()
    for path in run_path.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(run_path)
        if any(part.startswith((".", "_")) for part in relative.parts):
            continue
        visible.add(relative.as_posix())

    if visible != expected:
        unexpected = sorted(visible - expected)
        missing = sorted(expected - visible)
        raise PublicationError(
            "Spark-visible Parquet inventory does not match registered table files; "
            f"unexpected={unexpected}, missing={missing}"
        )


def _verify_published_output_files(
    run_path: Path,
    outputs: dict[str, Any],
) -> None:
    for relative_path, schema in _TABLE_SCHEMAS.items():
        expected = outputs.get(relative_path)
        if not isinstance(expected, dict):
            raise PublicationError(f"Completed output metadata is invalid for {relative_path}")
        if expected.get("schema") != schema.jsonValue():
            raise PublicationError(f"Completed output schema mismatch for {relative_path}")
        expected_schema_hash = hashlib.sha256(schema.json().encode("utf-8")).hexdigest()
        if expected.get("schema_sha256") != expected_schema_hash:
            raise PublicationError(f"Completed output schema hash mismatch for {relative_path}")
        row_count = expected.get("row_count")
        if isinstance(row_count, bool) or not isinstance(row_count, int) or row_count < 0:
            raise PublicationError(f"Completed output row count is invalid for {relative_path}")
        expected_files = expected.get("files")
        if not isinstance(expected_files, dict) or not expected_files:
            raise PublicationError(f"Completed output file hashes are missing for {relative_path}")
        actual_files = _parquet_file_metadata(run_path / relative_path)
        if set(actual_files) != set(expected_files):
            raise PublicationError(f"Completed output Parquet file set changed for {relative_path}")
        for name, actual in actual_files.items():
            expected_file = expected_files[name]
            if not isinstance(expected_file, dict) or actual != expected_file:
                raise PublicationError(f"Completed output Parquet file hash mismatch: {relative_path}/{name}")
    _validate_spark_visible_parquet_inventory(run_path)


def _validate_metric_accounting(serialized_rows: list[str]) -> None:
    rows = [json.loads(serialized_row) for serialized_row in serialized_rows]
    values = {(row["stage"], row["metric_name"]): row["value"] for row in rows}
    required_metrics = {
        ("bronze", "total_records"),
        ("bronze", "blank_records"),
        ("bronze", "comment_records"),
        ("bronze", "candidate_records"),
        ("silver", "quarantined_records"),
        ("silver", "valid_edge_occurrences"),
        ("silver", "unique_edges"),
        ("silver", "duplicate_excess"),
        ("silver", "observed_nodes"),
        ("gold", "nodes"),
        ("gold", "edges"),
    }
    if len(values) != len(rows) or set(values) != required_metrics:
        raise PipelineError("Quality metrics contain duplicate or unexpected stage/name pairs")
    try:
        validate_quality = {
            "total_records": values[("bronze", "total_records")],
            "blank_records": values[("bronze", "blank_records")],
            "comment_records": values[("bronze", "comment_records")],
            "candidate_records": values[("bronze", "candidate_records")],
            "quarantined_records": values[("silver", "quarantined_records")],
            "valid_edge_occurrences": values[("silver", "valid_edge_occurrences")],
            "unique_edges": values[("silver", "unique_edges")],
            "duplicate_excess": values[("silver", "duplicate_excess")],
        }
    except KeyError as error:
        raise PipelineError(f"Required quality metric is missing: {error}") from error
    validate_quality_accounting(**validate_quality)
    if values.get(("silver", "observed_nodes")) != values.get(("gold", "nodes")):
        raise PipelineError("Silver and Gold node counts disagree")
    if values.get(("silver", "unique_edges")) != values.get(("gold", "edges")):
        raise PipelineError("Silver and Gold edge counts disagree")


def _run_identity(source: ValidatedSource, run_id: str, extra_config: dict[str, Any]) -> dict[str, Any]:
    manifest = source.manifest
    return {
        "run_id": run_id,
        "dataset_id": manifest.dataset_id,
        "source_version": source.source_version,
        "source_sha256": source.source_sha256,
        "uncompressed_sha256": source.uncompressed_sha256,
        "source_file": manifest.source_file,
        "source_format": manifest.source_format,
        "graph_semantics": manifest.graph_semantics,
        "source_url": manifest.source_url,
        "acquired_at": manifest.acquired_at,
        "citation": manifest.citation,
        "rights_status": manifest.rights_status,
        "rights_evidence": manifest.rights_evidence,
        "expected_reference_counts": manifest.expected_reference_counts,
        "schema_version": manifest.schema_version,
        "transform_version": manifest.transform_version,
        "quality_policy_version": manifest.quality_policy_version,
        "extra_config": extra_config,
    }


def _runtime_provenance(spark: SparkSession) -> dict[str, str]:
    jvm = spark.sparkContext._jvm
    code_sha256, dependency_lock_sha256 = _code_and_lock_provenance()
    return {
        "python": sys.version.split()[0],
        "pyspark": pyspark.__version__,
        "py4j": py4j.__version__,
        "spark": spark.version,
        "java": jvm.java.lang.System.getProperty("java.version"),
        "java_home": jvm.java.lang.System.getProperty("java.home"),
        "code_sha256": code_sha256,
        "dependency_lock_sha256": dependency_lock_sha256,
    }


def run_pipeline(
    spark: SparkSession,
    source_path: Path,
    manifest_path: Path,
    output_root: Path,
    *,
    extra_config: dict[str, Any] | None = None,
) -> RunResult:
    manifest = load_manifest(Path(manifest_path))
    source = validate_source(Path(source_path), manifest)
    config = extra_config or {}
    run_id = stable_run_id(manifest, source.source_version, extra_config=config)
    identity = _run_identity(source, run_id, config)
    identity_sha256 = _canonical_sha256(identity)
    output_root = Path(output_root).resolve()
    final_path = output_root / manifest.dataset_id / "runs" / run_id

    if final_path.exists():
        existing = read_completed_run(final_path, run_id)
        if existing.get("identity_sha256") != identity_sha256:
            raise PublicationError("Existing completed run does not match the current source/config identity")
        if existing.get("runtime") != _runtime_provenance(spark):
            raise PublicationError("Existing run has different runtime, code, or dependency-lock provenance")
        _read_and_verify_outputs(spark, final_path, existing)
        return RunResult(final_path, run_id, True, existing)

    staging_path, final_path = create_staging_directory(output_root, manifest.dataset_id, run_id)
    silver = None
    try:
        ingested_at = datetime.now(timezone.utc)
        raw_edges, source_metadata = create_bronze_frames(spark, source, run_id)
        raw_path = staging_path / "bronze" / "raw_edges"
        metadata_path = staging_path / "bronze" / "source_metadata"
        _write_parquet(raw_edges, raw_path)
        _write_parquet(source_metadata, metadata_path)

        bronze_read = spark.read.schema(_parquet_read_schema(RAW_EDGE_SCHEMA)).parquet(str(raw_path))
        silver = transform_silver(spark, bronze_read)

        _write_parquet(silver.nodes, staging_path / "silver" / "nodes")
        _write_parquet(silver.edges, staging_path / "silver" / "edges")
        _write_parquet(silver.quarantine, staging_path / "silver" / "quarantine")

        gold_nodes, gold_edges = create_gold_frames(silver.nodes, silver.edges, manifest.dataset_id)
        _write_parquet(gold_nodes, staging_path / "gold" / "nodes")
        _write_parquet(gold_edges, staging_path / "gold" / "edges")

        gold_node_count = silver.counts["observed_nodes"]
        gold_edge_count = silver.counts["unique_edges"]
        gold_metrics = spark.createDataFrame(
            [
                (manifest.dataset_id, source.source_version, "gold", "nodes", gold_node_count),
                (manifest.dataset_id, source.source_version, "gold", "edges", gold_edge_count),
            ],
            schema=QUALITY_METRICS_SCHEMA,
        )
        quality_metrics = silver.quality_metrics.unionByName(gold_metrics)
        _write_parquet(quality_metrics, staging_path / "silver" / "quality_metrics")

        staged_outputs = _read_and_verify_outputs(spark, staging_path, {})

        run_manifest: dict[str, Any] = {
            "manifest_version": 1,
            "status": "validated",
            "identity": identity,
            "identity_sha256": identity_sha256,
            "dataset_id": manifest.dataset_id,
            "source_version": source.source_version,
            "source_file": manifest.source_file,
            "source_format": manifest.source_format,
            "graph_semantics": manifest.graph_semantics,
            "source_sha256": source.source_sha256,
            "uncompressed_sha256": source.uncompressed_sha256,
            "source_bytes": source.source_bytes,
            "content_bytes": source.content_bytes,
            "acquired_at": manifest.acquired_at,
            "source_url": manifest.source_url,
            "citation": manifest.citation,
            "rights_status": manifest.rights_status,
            "rights_evidence": manifest.rights_evidence,
            "schema_version": manifest.schema_version,
            "transform_version": manifest.transform_version,
            "quality_policy_version": manifest.quality_policy_version,
            "expected_reference_counts": manifest.expected_reference_counts,
            "run_id": run_id,
            "created_at": ingested_at.isoformat(),
            "runtime": _runtime_provenance(spark),
            "metrics": silver.counts | {"gold_nodes": gold_node_count, "gold_edges": gold_edge_count},
            "outputs": staged_outputs,
        }
        write_run_manifest(staging_path, run_manifest)
        publish_staged_run(staging_path, final_path, run_id)
        completed = read_completed_run(final_path, run_id)
        return RunResult(final_path, run_id, False, completed)
    except (SourceValidationError, PublicationError):
        raise
    except Exception as error:
        if isinstance(error, (PipelineError, QualityAccountingError)):
            raise
        raise PipelineError(f"Pipeline failed; incomplete staging retained at {staging_path}: {error}") from error
    finally:
        if silver is not None:
            silver.release()
