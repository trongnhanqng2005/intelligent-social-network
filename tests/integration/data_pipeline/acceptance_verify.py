from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from pyspark import SparkContext
from pyspark.sql import SparkSession, functions as F
from pyspark.sql.types import (
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)


_NULLABLE_FIELDS = {
    "bronze/source_metadata": {"acquired_at", "source_url", "rights_evidence"},
}
_HEX_256 = re.compile(r"^[0-9a-f]{64}$")


def _fail(message: str) -> None:
    raise AssertionError(message)


def _resource_snapshot() -> dict[str, Any]:
    cgroup = Path("/sys/fs/cgroup")

    def read_cgroup(name: str) -> str | None:
        path = cgroup / name
        return path.read_text(encoding="ascii").strip() if path.is_file() else None

    processes: list[dict[str, Any]] = []
    total_threads = 0
    total_open_fds = 0
    for proc_path in Path("/proc").glob("[0-9]*"):
        try:
            status_lines = (proc_path / "status").read_text(encoding="ascii").splitlines()
            status = {
                line.split(":", 1)[0]: line.split(":", 1)[1].strip()
                for line in status_lines
                if ":" in line
            }
            threads = int(status.get("Threads", "0"))
            fd_count = len(list((proc_path / "fd").iterdir()))
            total_threads += threads
            total_open_fds += fd_count
            name = (proc_path / "comm").read_text(encoding="ascii").strip()
            if name in {"java", "python", "python3"}:
                processes.append(
                    {
                        "pid": int(proc_path.name),
                        "name": name,
                        "threads": threads,
                        "open_fds": fd_count,
                        "rss_kib": int(status.get("VmRSS", "0 kB").split()[0]),
                    }
                )
        except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError):
            continue
    return {
        "pid": os.getpid(),
        "python_thread_count": threading.active_count(),
        "process_count": len(list(Path("/proc").glob("[0-9]*"))),
        "aggregate_thread_count": total_threads,
        "aggregate_open_fd_count": total_open_fds,
        "spark_processes": sorted(processes, key=lambda process: process["pid"]),
        "cgroup_memory_current_bytes": read_cgroup("memory.current"),
        "cgroup_memory_limit_bytes": read_cgroup("memory.max"),
        "cgroup_pids_current": read_cgroup("pids.current"),
        "cgroup_pids_limit": read_cgroup("pids.max"),
    }


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        _fail(f"Expected a JSON object: {path}")
    return value


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _logical_digest(rows: list[str]) -> str:
    return _digest("".join(row + "\n" for row in sorted(rows)).encode("utf-8"))


def _canonical_digest(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _digest(payload.encode("utf-8"))


def _uri_path(uri: str) -> Path:
    parsed = urlparse(uri)
    path = unquote(parsed.path) if parsed.scheme else uri
    return Path(path).resolve()


def _logical_lines(content: bytes) -> list[str]:
    lines = content.split(b"\n")
    if content.endswith(b"\n"):
        lines.pop()
    decoded: list[str] = []
    for line_number, raw in enumerate(lines, start=1):
        if raw.endswith(b"\r"):
            raw = raw[:-1]
        decoded.append(raw.decode("utf-8", errors="strict"))
    return decoded


def _load_source(source_path: Path, source_format: str, pins: dict[str, Any]) -> tuple[str, list[str]]:
    source = source_path.read_bytes()
    if len(source) != pins["source_bytes"] or _digest(source) != pins["source_sha256"]:
        _fail(f"Source bytes/hash differ from frozen host pins: {source_path.name}")
    content = gzip.decompress(source) if source_format == "gzip" else source
    if len(content) != pins["content_bytes"] or _digest(content) != pins["content_sha256"]:
        _fail(f"Decoded bytes/hash differ from frozen host pins: {source_path.name}")
    return _digest(source), _logical_lines(content)


def _run_id(dataset_id: str, source_version: str, versions: dict[str, str]) -> str:
    identity = {
        "dataset_id": dataset_id,
        "source_version": source_version,
        "schema_version": versions["schema"],
        "transform_version": versions["transform"],
        "quality_policy_version": versions["quality_policy"],
        "extra_config": {},
    }
    return _canonical_digest(identity)


def _record_ids(source_version: str, source_file: str, count: int) -> list[str]:
    return [
        _digest(f"{source_version}\0{source_file}\0{line_number}".encode("utf-8"))
        for line_number in range(1, count + 1)
    ]


def _schema_type(type_name: str) -> Any:
    if type_name in {"bigint", "long"}:
        return LongType()
    if type_name == "string":
        return StringType()
    if type_name == "timestamp":
        return TimestampType()
    _fail(f"Unexpected contract data type: {type_name}")


def _field_contracts(expected: dict[str, Any], table: str) -> list[tuple[str, str, bool]]:
    result: list[tuple[str, str, bool]] = []
    optional = _NULLABLE_FIELDS.get(table, set())
    for specification in expected["expected_parquet_schemas"][table]:
        name, data_type = specification.split(":", 1)
        result.append((name, data_type, name in optional))
    return result


def _check_schema(
    actual: StructType,
    expected: dict[str, Any],
    table: str,
    *,
    footer: bool,
    verify_nullability: bool = True,
) -> None:
    contracts = _field_contracts(expected, table)
    if len(actual.fields) != len(contracts):
        _fail(f"{table}: expected {len(contracts)} columns, got {actual.json()}")
    for field, (name, type_name, nullable) in zip(actual.fields, contracts, strict=True):
        if field.name != name or field.dataType.simpleString() != type_name:
            _fail(f"{table}: expected ordered field {(name, type_name)}, got {field.jsonValue()}")
        if field.metadata != {}:
            _fail(f"{table}.{name}: unexpected metadata {field.metadata}")
        if verify_nullability and footer and field.nullable != nullable:
            _fail(f"{table}.{name}: declared schema nullability {field.nullable}, expected {nullable}")
        if verify_nullability and not footer and not field.nullable:
            _fail(f"{table}.{name}: Spark read schema nullability was not normalized to true")


def _check_manifest_schema(
    output_record: dict[str, Any], expected: dict[str, Any], table: str
) -> StructType:
    declared_schema = StructType.fromJson(output_record["schema"])
    _check_schema(declared_schema, expected, table, footer=True)
    schema_digest = _digest(declared_schema.json().encode("utf-8"))
    if output_record.get("schema_sha256") != schema_digest:
        _fail(f"{table}: manifest schema hash differs from declared schema")
    return declared_schema


def _expected_record_data(
    expected: dict[str, Any], kind: str, manifest: dict[str, Any]
) -> tuple[list[str], list[tuple[int, str, str, str | None]], list[int], list[tuple[int, int, int]], dict[str, int]]:
    if kind == "f1":
        records = expected["records"]
        raw_records = [str(record["raw_text"]) for record in records]
        classifications = [
            (
                int(record["line_number"]),
                str(record["raw_text"]),
                str(record["classification"]),
                record.get("reason_code"),
            )
            for record in records
        ]
        nodes = [int(value) for value in expected["expected_silver_nodes"]]
        edges = [tuple(map(int, edge)) for edge in expected["expected_silver_edges"]]
        metrics = {key: int(value) for key, value in expected["expected_metrics"].items()}
        return raw_records, classifications, nodes, edges, metrics

    additional = expected["additional_inputs"][kind]
    if kind == "single_edge":
        raw_records = ["2 10"]
        classifications = [(1, "2 10", "valid", None)]
        return (
            raw_records,
            classifications,
            [2, 10],
            [tuple(map(int, edge)) for edge in additional["silver_edges"]],
            {key: int(value) for key, value in additional["metrics"].items()},
        )

    if kind == "resource":
        generator = additional["generator"]
        low, high = map(int, generator["edge_range"])
        raw_records: list[str] = []
        for node in range(low, high):
            raw_records.extend((f"{node} {node + 1}", f"{node + 1} {node}", f"{node} {node + 1}"))
        raw_records.extend("" for _ in range(int(generator["blank_records"])))
        raw_records.extend(f"# resource comment {index}" for index in range(int(generator["comment_records"])))
        raw_records.extend("malformed" for _ in range(int(generator["malformed_records"])))
        classifications: list[tuple[int, str, str, str | None]] = []
        for index, raw in enumerate(raw_records, start=1):
            if raw == "malformed":
                classification, reason = "quarantine", "INVALID_COLUMN_COUNT"
            elif not raw:
                classification, reason = "blank", None
            elif raw.startswith("#"):
                classification, reason = "comment", None
            else:
                classification, reason = "valid", None
            classifications.append((index, raw, classification, reason))
        nodes = list(range(low, high + 1))
        edges = [(node, node + 1, 3) for node in range(low, high)]
        metrics = {key: int(value) for key, value in additional["metrics"].items()}
        return raw_records, classifications, nodes, edges, metrics

    _fail(f"Unsupported successful acceptance input: {kind}")


def verify_run(
    spark: SparkSession,
    run_path: Path,
    source_path: Path,
    source_manifest_path: Path,
    expected_path: Path,
    kind: str,
    variant: str | None = None,
) -> dict[str, Any]:
    expected = _read_json(expected_path)
    source_manifest = _read_json(source_manifest_path)
    if kind == "f1":
        if variant not in expected["variants"]:
            _fail(f"Unknown F1 byte variant: {variant}")
        pins = expected["variants"][variant]
        versions = expected["versions"]
    elif kind in expected["additional_inputs"]:
        pins = expected["additional_inputs"][kind]
        versions = expected["versions"]
    else:
        _fail(f"Unknown expected input class: {kind}")

    source_version, actual_lines = _load_source(source_path, pins["source_format"], pins)
    dataset_id = source_manifest["dataset_id"]
    expected_dataset_id = (
        expected["dataset_id"] if kind == "f1" else expected["additional_inputs"][kind]["dataset_id"]
    )
    if dataset_id != expected_dataset_id:
        _fail("Input manifest dataset ID differs from the independently frozen case")
    if source_manifest["source_file"] != source_path.name:
        _fail("Input manifest source_file does not match the mounted source basename")
    if source_manifest["source_format"] != pins["source_format"]:
        _fail("Input manifest source format differs from the frozen case")
    if source_version != pins["source_sha256"]:
        _fail("Validated source identity differs from the frozen source pin")
    if source_manifest["source_sha256"] != source_version:
        _fail("Input manifest source SHA-256 differs from actual source bytes")
    if source_manifest["uncompressed_sha256"] != pins["content_sha256"]:
        _fail("Input manifest decoded SHA-256 differs from the frozen decoded-source pin")
    if source_manifest["source_bytes"] != pins["source_bytes"]:
        _fail("Input manifest source size differs from the frozen source pin")
    if source_manifest["content_bytes"] != pins["content_bytes"]:
        _fail("Input manifest decoded size differs from the frozen decoded-source pin")
    if source_manifest.get("manifest_version") != 1:
        _fail("Input manifest has an unsupported version")
    frozen_metadata = expected["expected_metadata"]
    for field, value in frozen_metadata.items():
        if source_manifest.get(field) != value:
            _fail(f"Input manifest {field} differs from the independently frozen synthetic metadata")
    for field in ("schema_version", "transform_version", "quality_policy_version"):
        if source_manifest.get(field) != versions[field.removesuffix("_version")]:
            _fail(f"Input manifest {field} differs from the frozen version contract")
    if source_manifest.get("graph_semantics") != "undirected_edge_list":
        _fail("Input manifest graph semantics differ from the frozen contract")
    if source_manifest["rights_status"] != "synthetic" or not source_manifest.get("rights_evidence"):
        _fail("Acceptance input must carry synthetic-source evidence")
    expected_run_id = _run_id(dataset_id, source_version, versions)
    if expected_run_id != pins["run_id"]:
        _fail("Independently recomputed run ID differs from the frozen host pin")
    ids = _record_ids(source_version, source_path.name, len(actual_lines))
    ids_payload = ("\n".join(ids) + "\n").encode("utf-8")
    if _digest(ids_payload) != pins["record_ids_logical_sha256"]:
        _fail("Independently derived record-ID fingerprint differs from frozen host evidence")

    marker_path = run_path / "_COMPLETE.json"
    run_manifest_path = run_path / "_RUN_MANIFEST.json"
    if not marker_path.is_file() or not run_manifest_path.is_file():
        _fail("Published run is missing its completion marker or run manifest")
    run_manifest_bytes = run_manifest_path.read_bytes()
    marker = _read_json(marker_path)
    run_manifest = json.loads(run_manifest_bytes.decode("utf-8"))
    if (
        marker.get("status") != "complete"
        or marker.get("completion_version") != 1
        or marker.get("run_id") != expected_run_id
    ):
        _fail("Completion marker status or run identity is invalid")
    if marker.get("run_manifest_sha256") != _digest(run_manifest_bytes):
        _fail("Completion marker does not protect the exact run-manifest bytes")
    if run_manifest.get("run_id") != expected_run_id:
        _fail("Run manifest ID differs from independently recomputed identity")
    if run_manifest.get("source_sha256") != source_version or run_manifest.get("source_version") != source_version:
        _fail("Run manifest source provenance mismatch")
    for field in (
        "dataset_id",
        "source_file",
        "source_format",
        "graph_semantics",
        "uncompressed_sha256",
        "source_bytes",
        "content_bytes",
        "acquired_at",
        "source_url",
        "citation",
        "rights_status",
        "rights_evidence",
        "schema_version",
        "transform_version",
        "quality_policy_version",
        "expected_reference_counts",
    ):
        if run_manifest.get(field) != source_manifest.get(field):
            _fail(f"Run manifest {field} differs from the independently read source manifest")
    runtime = run_manifest.get("runtime", {})
    if (
        runtime.get("python") != "3.12.15"
        or runtime.get("pyspark") != "3.5.9"
        or runtime.get("py4j") != "0.10.9.7"
        or runtime.get("spark") != "3.5.9"
        or not str(runtime.get("java", "")).startswith("17.")
        or not _HEX_256.fullmatch(str(runtime.get("code_sha256", "")))
        or not _HEX_256.fullmatch(str(runtime.get("dependency_lock_sha256", "")))
    ):
        _fail("Run runtime or code/lock fingerprint does not satisfy the pinned environment contract")

    raw_records, classifications, nodes, edges, metrics = _expected_record_data(
        expected, kind, source_manifest
    )
    if actual_lines != raw_records:
        _fail("Decoded source logical lines differ from independently authored expectations")

    actual_identity = run_manifest.get("identity", {})
    expected_identity = {
        "run_id": expected_run_id,
        "dataset_id": dataset_id,
        "source_version": source_version,
        "source_sha256": source_version,
        "uncompressed_sha256": pins["content_sha256"],
        "source_file": source_manifest["source_file"],
        "source_format": source_manifest["source_format"],
        "graph_semantics": source_manifest["graph_semantics"],
        "source_url": source_manifest.get("source_url"),
        "acquired_at": source_manifest.get("acquired_at"),
        "citation": source_manifest["citation"],
        "rights_status": source_manifest["rights_status"],
        "rights_evidence": source_manifest["rights_evidence"],
        "expected_reference_counts": source_manifest.get("expected_reference_counts"),
        "schema_version": source_manifest["schema_version"],
        "transform_version": source_manifest["transform_version"],
        "quality_policy_version": source_manifest["quality_policy_version"],
        "extra_config": {},
    }
    if actual_identity != expected_identity:
        _fail("Run identity/provenance fields differ from the independently read source manifest")
    if run_manifest.get("identity_sha256") != _canonical_digest(expected_identity):
        _fail("Run identity SHA-256 differs from independent canonical JSON")
    if run_manifest.get("dataset_id") != dataset_id:
        _fail("Run manifest dataset ID mismatch")
    if not isinstance(run_manifest.get("outputs"), dict):
        _fail("Run manifest output inventory is missing")
    output_entries = run_manifest["outputs"]
    schemas = expected["expected_parquet_schemas"]
    if set(output_entries) != set(schemas):
        _fail("Run manifest does not list exactly the eight implemented tables")

    record_ids_by_line = {line: record_id for line, record_id in enumerate(ids, start=1)}
    expected_lines = {
        number: (raw, classification, reason)
        for number, raw, classification, reason in classifications
    }
    data_by_table: dict[str, list[dict[str, Any]]] = {}
    summary: dict[str, Any] = {"run_id": expected_run_id, "tables": {}, "metrics": {}}
    expected_file_paths: set[Path] = set()

    for table, schema_fields in schemas.items():
        table_path = run_path.joinpath(*table.split("/"))
        if not table_path.is_dir():
            _fail(f"Published table directory is missing: {table}")
        frame = spark.read.schema(_table_read_schema(expected, table)).parquet(str(table_path))
        _check_schema(frame.schema, expected, table, footer=False)
        field_names = [field.split(":", 1)[0] for field in schema_fields]
        logical_field_list = [F.col(name) for name in field_names]
        materialized = frame.select(
            "*",
            F.to_json(
                F.struct(*logical_field_list),
                options={"ignoreNullFields": "false"},
            ).alias("__acceptance_logical_row"),
        )
        collected = materialized.collect()
        row_dicts: list[dict[str, Any]] = []
        logical_rows: list[str] = []
        for row in collected:
            values = row.asDict(recursive=True)
            logical_rows.append(values.pop("__acceptance_logical_row"))
            row_dicts.append(values)
        data_by_table[table] = row_dicts

        required_names = {
            name for name, _, nullable in _field_contracts(expected, table) if not nullable
        }
        if any(any(row.get(name) is None for name in required_names) for row in row_dicts):
            _fail(f"{table}: actual read-back contains null in a required field")

        expected_files = output_entries[table].get("files")
        if not isinstance(expected_files, dict) or not expected_files:
            _fail(f"{table}: run manifest has no protected Parquet file inventory")
        listed_paths: set[Path] = set()
        for file_name, file_record in expected_files.items():
            if Path(file_name).name != file_name or not file_name.endswith(".parquet"):
                _fail(f"{table}: unsafe or non-Parquet inventory entry {file_name!r}")
            file_path = table_path / file_name
            if not file_path.is_file():
                _fail(f"{table}: registered Parquet file is missing: {file_name}")
            file_bytes = file_path.read_bytes()
            if len(file_bytes) != file_record.get("bytes") or _digest(file_bytes) != file_record.get("sha256"):
                _fail(f"{table}: registered file size/hash mismatch: {file_name}")
            listed_paths.add(file_path.resolve())
            expected_file_paths.add(file_path.resolve())

            footer = spark.sparkContext._jvm.org.apache.parquet.hadoop.ParquetFileReader.readFooter(
                spark.sparkContext._jsc.hadoopConfiguration(),
                spark.sparkContext._jvm.org.apache.hadoop.fs.Path(str(file_path)),
            )
            footer_metadata = footer.getFileMetaData().getKeyValueMetaData()
            schema_json = footer_metadata.get("org.apache.spark.sql.parquet.row.metadata")
            if schema_json is None:
                _fail(f"{table}: footer schema metadata is missing: {file_name}")
            footer_schema = StructType.fromJson(json.loads(schema_json))
            _check_schema(
                footer_schema,
                expected,
                table,
                footer=True,
                verify_nullability=False,
            )
            codecs = {
                column.getCodec().name()
                for block in footer.getBlocks()
                for column in block.getColumns()
            }
            if row_dicts and codecs != {"SNAPPY"}:
                _fail(f"{table}: expected SNAPPY footer codec, got {sorted(codecs)}")
            if not row_dicts and codecs not in (set(), {"SNAPPY"}):
                _fail(f"{table}: unexpected empty-table codecs {sorted(codecs)}")

        reader_paths = {_uri_path(uri) for uri in frame.inputFiles()}
        if reader_paths != listed_paths:
            _fail(
                f"{table}: Spark-visible file set differs from registered inventory; "
                f"visible={sorted(map(str, reader_paths))}, registered={sorted(map(str, listed_paths))}"
            )

        output_record = output_entries[table]
        _check_manifest_schema(output_record, expected, table)
        logical_digest = _logical_digest(logical_rows)
        if output_record.get("row_count") != len(row_dicts):
            _fail(f"{table}: manifest row_count differs from actual Spark rows")
        if output_record.get("logical_sha256") != logical_digest:
            _fail(f"{table}: manifest logical hash differs from independently serialized rows")
        _check_schema(StructType.fromJson(output_record["read_schema"]), expected, table, footer=False)
        summary["tables"][table] = {
            "row_count": len(row_dicts),
            "schema": schema_fields,
            "files": sorted(expected_files),
            "logical_sha256": logical_digest,
            "spark_visible_files": sorted(map(str, reader_paths)),
        }

    all_visible = spark.read.schema(_combined_read_schema(spark, expected)).option(
        "recursiveFileLookup", "true"
    ).parquet(str(run_path)).inputFiles()
    root_visible_paths = {_uri_path(uri) for uri in all_visible}
    if root_visible_paths != expected_file_paths:
        _fail(
            "Run-root recursive Spark read sees a Parquet inventory different from registered outputs; "
            f"visible={sorted(map(str, root_visible_paths))}, expected={sorted(map(str, expected_file_paths))}"
        )

    _compare_expected_rows(
        expected,
        kind,
        source_manifest,
        source_version,
        expected_run_id,
        run_manifest,
        actual_lines,
        record_ids_by_line,
        expected_lines,
        data_by_table,
        nodes,
        edges,
        metrics,
    )
    summary["metrics"] = metrics
    summary["identity_sha256"] = run_manifest["identity_sha256"]
    summary["completion_manifest_sha256"] = marker["run_manifest_sha256"]
    summary["runtime"] = {
        "python": runtime["python"],
        "pyspark": runtime["pyspark"],
        "py4j": runtime["py4j"],
        "spark": runtime["spark"],
        "java": runtime["java"],
    }
    return summary


def _combined_read_schema(spark: SparkSession, expected: dict[str, Any]) -> StructType:
    data_types: dict[str, Any] = {}
    for fields in expected["expected_parquet_schemas"].values():
        for specification in fields:
            name, type_name = specification.split(":", 1)
            data_type = _schema_type(type_name)
            prior = data_types.get(name)
            if prior is not None and prior.json() != data_type.json():
                _fail(f"Tables disagree on the shared field type for {name}")
            data_types.setdefault(name, data_type)
    return StructType(
        [StructField(name, data_type, nullable=True) for name, data_type in data_types.items()]
    )


def _table_read_schema(expected: dict[str, Any], table: str) -> StructType:
    return StructType(
        [
            StructField(name, _schema_type(type_name), nullable=True)
            for name, type_name, _ in _field_contracts(expected, table)
        ]
    )


def _compare_expected_rows(
    expected: dict[str, Any],
    kind: str,
    manifest: dict[str, Any],
    source_version: str,
    run_id: str,
    run_manifest: dict[str, Any],
    raw_lines: list[str],
    record_ids: dict[int, str],
    classifications: dict[int, tuple[str, str, str | None]],
    rows: dict[str, list[dict[str, Any]]],
    nodes: list[int],
    edges: list[tuple[int, int, int]],
    metrics: dict[str, int],
) -> None:
    dataset_id = manifest["dataset_id"]
    source_file = manifest["source_file"]
    expected_bronze = [
        (
            dataset_id,
            source_version,
            source_file,
            line_number,
            record_ids[line_number],
            raw,
        )
        for line_number, raw in enumerate(raw_lines, start=1)
    ]
    actual_bronze = [
        (
            row["dataset_id"], row["source_version"], row["source_file"], row["line_number"],
            row["record_id"], row["raw_text"],
        )
        for row in rows["bronze/raw_edges"]
    ]
    if sorted(actual_bronze, key=lambda row: row[3]) != expected_bronze:
        _fail("bronze/raw_edges logical records differ from frozen line/text/identity expectations")
    for row in rows["bronze/raw_edges"]:
        if row.get("ingested_at") is None:
            _fail("bronze/raw_edges contains a null ingested_at")

    expected_metadata = {
        "dataset_id": dataset_id,
        "source_version": source_version,
        "source_file": manifest["source_file"],
        "source_format": manifest["source_format"],
        "graph_semantics": manifest["graph_semantics"],
        "source_sha256": source_version,
        "uncompressed_sha256": manifest["uncompressed_sha256"],
        "source_bytes": manifest["source_bytes"],
        "content_bytes": manifest["content_bytes"],
        "acquired_at": manifest.get("acquired_at"),
        "source_url": manifest.get("source_url"),
        "citation": manifest["citation"],
        "rights_status": manifest["rights_status"],
        "rights_evidence": manifest["rights_evidence"],
        "schema_version": manifest["schema_version"],
        "transform_version": manifest["transform_version"],
        "quality_policy_version": manifest["quality_policy_version"],
        "run_id": run_id,
    }
    if len(rows["bronze/source_metadata"]) != 1:
        _fail("bronze/source_metadata must contain exactly one record")
    metadata = rows["bronze/source_metadata"][0]
    for field, value in expected_metadata.items():
        if metadata.get(field) != value:
            _fail(f"bronze/source_metadata.{field} differs from source manifest")
    if metadata.get("ingested_at") is None:
        _fail("bronze/source_metadata.ingested_at is null")

    expected_nodes = [(dataset_id, source_version, node) for node in nodes]
    actual_nodes = [
        (row["dataset_id"], row["source_version"], row["source_node_id"])
        for row in rows["silver/nodes"]
    ]
    if sorted(actual_nodes) != sorted(expected_nodes):
        _fail("silver/nodes differs from independently specified endpoint catalog")

    expected_edges = [(dataset_id, source_version, *edge) for edge in edges]
    actual_edges = [
        (
            row["dataset_id"], row["source_version"], row["source_node_id_low"],
            row["source_node_id_high"], row["source_record_count"],
        )
        for row in rows["silver/edges"]
    ]
    if sorted(actual_edges) != sorted(expected_edges):
        _fail("silver/edges differs from independently calculated canonical pairs/counts")

    expected_quarantine = []
    for line_number, (raw, classification, reason) in classifications.items():
        if classification == "quarantine":
            expected_quarantine.append(
                (dataset_id, source_version, record_ids[line_number], source_file, line_number, raw, reason)
            )
    actual_quarantine = [
        (
            row["dataset_id"], row["source_version"], row["record_id"], row["source_file"],
            row["line_number"], row["raw_text"], row["reason_code"],
        )
        for row in rows["silver/quarantine"]
    ]
    if sorted(actual_quarantine, key=lambda row: row[4]) != sorted(expected_quarantine, key=lambda row: row[4]):
        _fail("silver/quarantine exact records/reason precedence differ from frozen expectations")

    expected_gold_nodes = [
        (dataset_id, source_version, f"{dataset_id}:{node}", node) for node in nodes
    ]
    actual_gold_nodes = [
        (row["dataset_id"], row["source_version"], row["node_id"], row["source_node_id"])
        for row in rows["gold/nodes"]
    ]
    if sorted(actual_gold_nodes) != sorted(expected_gold_nodes):
        _fail("gold/nodes identities differ from independently mapped source IDs")

    expected_gold_edges = [
        (dataset_id, source_version, f"{dataset_id}:{low}", f"{dataset_id}:{high}")
        for low, high, _ in edges
    ]
    actual_gold_edges = [
        (row["dataset_id"], row["source_version"], row["node_id_low"], row["node_id_high"])
        for row in rows["gold/edges"]
    ]
    if sorted(actual_gold_edges) != sorted(expected_gold_edges):
        _fail("gold/edges differ from independently mapped numeric canonical endpoints")
    if len(set(actual_gold_edges)) != len(actual_gold_edges):
        _fail("gold/edges contains duplicate logical edges")
    gold_node_ids = {row[2] for row in expected_gold_nodes}
    if any(low == high or low not in gold_node_ids or high not in gold_node_ids for _, _, low, high in actual_gold_edges):
        _fail("Gold graph contains a self-loop or dangling endpoint")

    actual_metrics = {
        f"{row['stage']}.{row['metric_name']}": row["value"]
        for row in rows["silver/quality_metrics"]
    }
    if any(
        row["dataset_id"] != dataset_id or row["source_version"] != source_version
        for row in rows["silver/quality_metrics"]
    ):
        _fail("silver/quality_metrics contains inconsistent dataset/source identities")
    if len(actual_metrics) != len(rows["silver/quality_metrics"]):
        _fail("silver/quality_metrics contains duplicate stage/metric identities")
    if actual_metrics != metrics:
        _fail(f"Quality metrics mismatch: expected={metrics}, actual={actual_metrics}")
    expected_run_metrics = {
        "total_records": metrics["bronze.total_records"],
        "blank_records": metrics["bronze.blank_records"],
        "comment_records": metrics["bronze.comment_records"],
        "candidate_records": metrics["bronze.candidate_records"],
        "quarantined_records": metrics["silver.quarantined_records"],
        "valid_edge_occurrences": metrics["silver.valid_edge_occurrences"],
        "unique_edges": metrics["silver.unique_edges"],
        "duplicate_excess": metrics["silver.duplicate_excess"],
        "observed_nodes": metrics["silver.observed_nodes"],
        "gold_nodes": metrics["gold.nodes"],
        "gold_edges": metrics["gold.edges"],
    }
    if run_manifest.get("metrics") != expected_run_metrics:
        _fail("Run-manifest metrics differ from independent quality-table accounting")
    if metrics["bronze.total_records"] != (
        metrics["bronze.blank_records"] + metrics["bronze.comment_records"] + metrics["bronze.candidate_records"]
    ):
        _fail("Bronze record accounting does not conserve source records")
    if metrics["bronze.candidate_records"] != (
        metrics["silver.quarantined_records"] + metrics["silver.valid_edge_occurrences"]
    ):
        _fail("Candidate records do not reconcile to quarantine plus valid occurrences")
    if metrics["silver.valid_edge_occurrences"] != (
        metrics["silver.unique_edges"] + metrics["silver.duplicate_excess"]
    ):
        _fail("Valid occurrences do not reconcile to unique edges plus duplicate excess")
    if metrics["silver.observed_nodes"] != metrics["gold.nodes"] or metrics["silver.unique_edges"] != metrics["gold.edges"]:
        _fail("Silver/Gold graph metrics disagree")


def _spark_session() -> SparkSession:
    spark = (
        SparkSession.builder.master("local[2]")
        .appName("isn-b-independent-acceptance-verifier")
        .config("spark.ui.enabled", "false")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.rpc.io.serverThreads", "2")
        .config("spark.rpc.io.clientThreads", "2")
        .config("spark.shuffle.io.serverThreads", "2")
        .config("spark.shuffle.io.clientThreads", "2")
        .config("spark.executor.processTreeMetrics.enabled", "false")
        .config("spark.driver.processTreeMetrics.enabled", "false")
        .config("spark.sql.parquet.compression.codec", "snappy")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    return spark


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-manifest", type=Path, required=True)
    parser.add_argument("--expected", type=Path, required=True)
    args = parser.parse_args()
    case_manifest = _read_json(args.case_manifest)
    resources_before = _resource_snapshot()
    spark = _spark_session()
    reports: list[dict[str, Any]] = []
    try:
        for case in case_manifest["cases"]:
            report = verify_run(
                spark,
                Path(case["run_path"]),
                Path(case["source_path"]),
                Path(case["source_manifest_path"]),
                args.expected,
                case["kind"],
                case.get("variant"),
            )
            report["case_name"] = case["case_name"]
            reports.append(report)
    finally:
        spark.stop()
    spark_context_stopped = (
        spark.sparkContext._jsc is None and SparkContext._active_spark_context is None
    )
    active_context = SparkSession.getActiveSession()
    resources_after = _resource_snapshot()
    print(
        json.dumps(
            {
                "status": "PASS",
                "cases": reports,
                "resources": {
                    "before_spark": resources_before,
                    "after_spark_stop": resources_after,
                    "spark_context_stopped": spark_context_stopped,
                    "active_spark_session_after_stop": active_context is not None,
                },
            },
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
