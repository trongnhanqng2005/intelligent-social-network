from pyspark.sql.types import (
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)


def _required(name: str, data_type: object) -> StructField:
    return StructField(name, data_type, nullable=False)


RAW_EDGE_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("source_file", StringType()),
        _required("line_number", LongType()),
        _required("record_id", StringType()),
        _required("raw_text", StringType()),
        _required("ingested_at", TimestampType()),
    ]
)

SOURCE_METADATA_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("source_file", StringType()),
        _required("source_format", StringType()),
        _required("graph_semantics", StringType()),
        _required("source_sha256", StringType()),
        _required("uncompressed_sha256", StringType()),
        _required("source_bytes", LongType()),
        _required("content_bytes", LongType()),
        StructField("acquired_at", StringType(), nullable=True),
        StructField("source_url", StringType(), nullable=True),
        _required("citation", StringType()),
        _required("rights_status", StringType()),
        StructField("rights_evidence", StringType(), nullable=True),
        _required("schema_version", StringType()),
        _required("transform_version", StringType()),
        _required("quality_policy_version", StringType()),
        _required("run_id", StringType()),
        _required("ingested_at", TimestampType()),
    ]
)

SILVER_NODES_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("source_node_id", LongType()),
    ]
)

SILVER_EDGES_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("source_node_id_low", LongType()),
        _required("source_node_id_high", LongType()),
        _required("source_record_count", LongType()),
    ]
)

QUARANTINE_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("record_id", StringType()),
        _required("source_file", StringType()),
        _required("line_number", LongType()),
        _required("raw_text", StringType()),
        _required("reason_code", StringType()),
    ]
)

QUALITY_METRICS_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("stage", StringType()),
        _required("metric_name", StringType()),
        _required("value", LongType()),
    ]
)

GOLD_NODES_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("node_id", StringType()),
        _required("source_node_id", LongType()),
    ]
)

GOLD_EDGES_SCHEMA = StructType(
    [
        _required("dataset_id", StringType()),
        _required("source_version", StringType()),
        _required("node_id_low", StringType()),
        _required("node_id_high", StringType()),
    ]
)
