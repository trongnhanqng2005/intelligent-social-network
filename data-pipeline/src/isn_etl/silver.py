from __future__ import annotations

import re
from dataclasses import dataclass

from pyspark import StorageLevel
from pyspark.sql import DataFrame, SparkSession, functions as F

from isn_etl.schemas import (
    QUARANTINE_SCHEMA,
    QUALITY_METRICS_SCHEMA,
    SILVER_EDGES_SCHEMA,
    SILVER_NODES_SCHEMA,
)


_UNSIGNED_DECIMAL = re.compile(r"^[0-9]+$", flags=re.ASCII)
_MAX_SIGNED_64 = 2**63 - 1

class QualityAccountingError(ValueError):
    """The observed record and edge totals violate an ETL invariant."""


@dataclass
class SilverFrames:
    nodes: DataFrame
    edges: DataFrame
    quarantine: DataFrame
    quality_metrics: DataFrame
    counts: dict[str, int]
    _persisted_frames: tuple[DataFrame, ...]

    def release(self) -> None:
        for frame in self._persisted_frames:
            frame.unpersist(blocking=True)


def _parse_identifier(token: str) -> tuple[int | None, str | None]:
    if not _UNSIGNED_DECIMAL.fullmatch(token):
        return None, "INVALID_IDENTIFIER"
    canonical = token.lstrip("0") or "0"
    if len(canonical) > 19:
        return None, "IDENTIFIER_OUT_OF_RANGE"
    value = int(canonical)
    if value > _MAX_SIGNED_64:
        return None, "IDENTIFIER_OUT_OF_RANGE"
    return value, None


def parse_edge_text(raw_text: str) -> tuple[str, int | None, int | None, str | None]:
    """Return classification, canonical endpoints, and deterministic reason code."""
    if not raw_text.strip():
        return "blank", None, None, None
    if raw_text.lstrip().startswith("#"):
        return "comment", None, None, None

    columns = raw_text.split()
    if len(columns) != 2:
        return "quarantine", None, None, "INVALID_COLUMN_COUNT"

    left, left_error = _parse_identifier(columns[0])
    right, right_error = _parse_identifier(columns[1])
    if left_error == "INVALID_IDENTIFIER" or right_error == "INVALID_IDENTIFIER":
        return "quarantine", None, None, "INVALID_IDENTIFIER"
    if left_error or right_error:
        return "quarantine", None, None, "IDENTIFIER_OUT_OF_RANGE"

    assert left is not None and right is not None
    if left == right:
        return "quarantine", None, None, "SELF_LOOP"
    return "valid", min(left, right), max(left, right), None


def validate_quality_accounting(
    *,
    total_records: int,
    blank_records: int,
    comment_records: int,
    candidate_records: int,
    quarantined_records: int,
    valid_edge_occurrences: int,
    unique_edges: int,
    duplicate_excess: int,
) -> None:
    counts = {
        "total_records": total_records,
        "blank_records": blank_records,
        "comment_records": comment_records,
        "candidate_records": candidate_records,
        "quarantined_records": quarantined_records,
        "valid_edge_occurrences": valid_edge_occurrences,
        "unique_edges": unique_edges,
        "duplicate_excess": duplicate_excess,
    }
    if any(not isinstance(value, int) or value < 0 for value in counts.values()):
        raise QualityAccountingError(f"Quality counts must be non-negative integers: {counts}")
    if total_records != blank_records + comment_records + candidate_records:
        raise QualityAccountingError("total_records must equal blank + comment + candidate records")
    if candidate_records != quarantined_records + valid_edge_occurrences:
        raise QualityAccountingError("candidate_records must equal quarantined + valid occurrences")
    if valid_edge_occurrences != unique_edges + duplicate_excess:
        raise QualityAccountingError("valid occurrences must equal unique edges + duplicate excess")


def transform_silver(spark: SparkSession, raw_edges: DataFrame) -> SilverFrames:
    raw = raw_edges
    for token, capture in (("_left_token", 1), ("_right_token", 2)):
        raw = raw.withColumn(
            token,
            F.regexp_extract(F.col("raw_text"), r"^\s*([^\s]+)\s+([^\s]+)\s*$", capture),
        )

    raw = raw.withColumn("_two_columns", F.col("raw_text").rlike(r"^\s*[^\s]+\s+[^\s]+\s*$"))
    for side in ("left", "right"):
        token = F.col(f"_{side}_token")
        canonical = F.regexp_replace(token, r"^0+", "")
        canonical = F.when(canonical == "", F.lit("0")).otherwise(canonical)
        is_decimal = token.rlike(r"^[0-9]+$")
        in_range = (F.length(canonical) < 19) | (
            (F.length(canonical) == 19) & (canonical <= F.lit(str(_MAX_SIGNED_64)))
        )
        raw = (
            raw.withColumn(f"_{side}_canonical", canonical)
            .withColumn(f"_{side}_decimal", is_decimal)
            .withColumn(f"_{side}_in_range", is_decimal & in_range)
            .withColumn(
                f"_{side}_numeric",
                F.when(F.col(f"_{side}_in_range"), F.col(f"_{side}_canonical").cast("long")),
            )
        )

    blank = F.col("raw_text").rlike(r"^\s*$")
    comment = F.col("raw_text").rlike(r"^\s*#")
    invalid_identifier = ~F.col("_left_decimal") | ~F.col("_right_decimal")
    out_of_range = ~F.col("_left_in_range") | ~F.col("_right_in_range")
    self_loop = F.col("_left_canonical") == F.col("_right_canonical")
    classification = (
        F.when(blank, "blank")
        .when(comment, "comment")
        .when(~F.col("_two_columns"), "quarantine")
        .when(invalid_identifier, "quarantine")
        .when(out_of_range, "quarantine")
        .when(self_loop, "quarantine")
        .otherwise("valid")
    )
    reason_code = (
        F.when(~F.col("_two_columns"), "INVALID_COLUMN_COUNT")
        .when(invalid_identifier, "INVALID_IDENTIFIER")
        .when(out_of_range, "IDENTIFIER_OUT_OF_RANGE")
        .when(self_loop, "SELF_LOOP")
    )
    parsed_records = raw.withColumn("_classification", classification).withColumn(
        "_reason_code", reason_code
    ).persist(StorageLevel.MEMORY_AND_DISK)
    persisted_frames = [parsed_records]
    try:
        categories = parsed_records.agg(
            F.count(F.lit(1)).cast("long").alias("total_records"),
            F.first("dataset_id").alias("dataset_id"),
            F.first("source_version").alias("source_version"),
            *[
                F.coalesce(
                    F.sum(F.when(F.col("_classification") == category, F.lit(1)).otherwise(F.lit(0))),
                    F.lit(0),
                ).cast("long").alias(category)
                for category in ("blank", "comment", "quarantine", "valid")
            ]
        ).first()
        total_records = categories.total_records
        blank_records = categories.blank
        comment_records = categories.comment
        quarantined_records = categories.quarantine
        valid_edge_occurrences = categories.valid
        candidate_records = total_records - blank_records - comment_records

        quarantine = parsed_records.where(F.col("_classification") == "quarantine").select(
            "dataset_id",
            "source_version",
            "record_id",
            "source_file",
            "line_number",
            "raw_text",
            F.col("_reason_code").alias("reason_code"),
        ).select(*QUARANTINE_SCHEMA.fieldNames())
        occurrences = parsed_records.where(F.col("_classification") == "valid").select(
            "dataset_id",
            "source_version",
            F.least("_left_numeric", "_right_numeric").alias("source_node_id_low"),
            F.greatest("_left_numeric", "_right_numeric").alias("source_node_id_high"),
        )
        edges = (
            occurrences.groupBy(
                "dataset_id",
                "source_version",
                "source_node_id_low",
                "source_node_id_high",
            )
            .agg(F.count(F.lit(1)).cast("long").alias("source_record_count"))
            .select(*SILVER_EDGES_SCHEMA.fieldNames())
        ).persist(StorageLevel.MEMORY_AND_DISK)
        persisted_frames.append(edges)
        nodes = (
            occurrences.select(
                "dataset_id", "source_version", F.col("source_node_id_low").alias("source_node_id")
            )
            .unionByName(
                occurrences.select(
                    "dataset_id", "source_version", F.col("source_node_id_high").alias("source_node_id")
                )
            )
            .distinct()
            .select(*SILVER_NODES_SCHEMA.fieldNames())
        ).persist(StorageLevel.MEMORY_AND_DISK)
        persisted_frames.append(nodes)
        stage_counts = (
            nodes.agg(F.count(F.lit(1)).cast("long").alias("value"))
            .select(F.lit("observed_nodes").alias("name"), "value")
            .unionByName(
                edges.agg(F.count(F.lit(1)).cast("long").alias("value")).select(
                    F.lit("unique_edges").alias("name"), "value"
                )
            )
            .collect()
        )
        observed_counts = {row.name: row.value for row in stage_counts}
        unique_edges = observed_counts["unique_edges"]
        observed_nodes = observed_counts["observed_nodes"]
        duplicate_excess = valid_edge_occurrences - unique_edges
        validate_quality_accounting(
            total_records=total_records,
            blank_records=blank_records,
            comment_records=comment_records,
            candidate_records=candidate_records,
            quarantined_records=quarantined_records,
            valid_edge_occurrences=valid_edge_occurrences,
            unique_edges=unique_edges,
            duplicate_excess=duplicate_excess,
        )
        if unique_edges == 0 or observed_nodes == 0:
            raise QualityAccountingError("Source contains no valid graph edges")
        counts = {
            "total_records": total_records,
            "blank_records": blank_records,
            "comment_records": comment_records,
            "candidate_records": candidate_records,
            "quarantined_records": quarantined_records,
            "valid_edge_occurrences": valid_edge_occurrences,
            "unique_edges": unique_edges,
            "duplicate_excess": duplicate_excess,
            "observed_nodes": observed_nodes,
        }
        dataset_id = categories.dataset_id
        source_version = categories.source_version
        metrics = [
            (dataset_id, source_version, stage, name, counts[name])
            for stage, names in (
                ("bronze", ("total_records", "blank_records", "comment_records", "candidate_records")),
                (
                    "silver",
                    (
                        "quarantined_records",
                        "valid_edge_occurrences",
                        "unique_edges",
                        "duplicate_excess",
                        "observed_nodes",
                    ),
                ),
            )
            for name in names
        ]
        quality_metrics = spark.createDataFrame(metrics, schema=QUALITY_METRICS_SCHEMA)
        return SilverFrames(nodes, edges, quarantine, quality_metrics, counts, tuple(persisted_frames))
    except Exception:
        for frame in persisted_frames:
            frame.unpersist(blocking=True)
        raise
