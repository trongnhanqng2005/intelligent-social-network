from __future__ import annotations

from datetime import datetime, timezone

from pyspark.sql import DataFrame, SparkSession

from isn_etl.provenance import ValidatedSource, stable_record_id
from isn_etl.schemas import RAW_EDGE_SCHEMA, SOURCE_METADATA_SCHEMA


def create_bronze_frames(
    spark: SparkSession,
    source: ValidatedSource,
    run_id: str,
) -> tuple[DataFrame, DataFrame]:
    manifest = source.manifest
    ingested_at = datetime.now(timezone.utc).replace(tzinfo=None)
    raw_rows = [
        (
            manifest.dataset_id,
            source.source_version,
            manifest.source_file,
            line_number,
            stable_record_id(source.source_version, manifest.source_file, line_number),
            raw_text,
            ingested_at,
        )
        for line_number, raw_text in source.records
    ]
    raw_edges = spark.createDataFrame(raw_rows, schema=RAW_EDGE_SCHEMA)

    metadata_row = (
        manifest.dataset_id,
        source.source_version,
        manifest.source_file,
        manifest.source_format,
        manifest.graph_semantics,
        source.source_sha256,
        source.uncompressed_sha256,
        source.source_bytes,
        source.content_bytes,
        manifest.acquired_at,
        manifest.source_url,
        manifest.citation,
        manifest.rights_status,
        manifest.rights_evidence,
        manifest.schema_version,
        manifest.transform_version,
        manifest.quality_policy_version,
        run_id,
        ingested_at,
    )
    source_metadata = spark.createDataFrame([metadata_row], schema=SOURCE_METADATA_SCHEMA)
    return raw_edges, source_metadata
