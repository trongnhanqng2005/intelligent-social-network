from __future__ import annotations

from pyspark.sql import DataFrame, functions as F

from isn_etl.schemas import GOLD_EDGES_SCHEMA, GOLD_NODES_SCHEMA


class GraphIntegrityError(ValueError):
    """Gold graph rows violate canonical or endpoint integrity."""


def analytical_node_id(dataset_id: str, source_node_id: int) -> str:
    if not isinstance(dataset_id, str) or not dataset_id:
        raise ValueError("dataset_id must be a non-empty string")
    if isinstance(source_node_id, bool) or not isinstance(source_node_id, int):
        raise ValueError("source_node_id must be an integer")
    if source_node_id < 0 or source_node_id > 2**63 - 1:
        raise ValueError("source_node_id must fit a signed 64-bit non-negative integer")
    return f"{dataset_id}:{source_node_id}"


def create_gold_frames(
    silver_nodes: DataFrame,
    silver_edges: DataFrame,
    dataset_id: str,
) -> tuple[DataFrame, DataFrame]:
    prefix = f"{dataset_id}:"
    gold_nodes = silver_nodes.select(
        "dataset_id",
        "source_version",
        F.concat(F.lit(prefix), F.col("source_node_id").cast("string")).alias("node_id"),
        "source_node_id",
    ).select(*GOLD_NODES_SCHEMA.fieldNames())
    gold_edges = silver_edges.select(
        "dataset_id",
        "source_version",
        F.concat(F.lit(prefix), F.col("source_node_id_low").cast("string")).alias("node_id_low"),
        F.concat(F.lit(prefix), F.col("source_node_id_high").cast("string")).alias("node_id_high"),
    ).select(*GOLD_EDGES_SCHEMA.fieldNames())
    return gold_nodes, gold_edges


def validate_graph_integrity(gold_nodes: DataFrame, gold_edges: DataFrame) -> None:
    invalid_nodes = gold_nodes.where(
        F.col("node_id")
        != F.concat(F.col("dataset_id"), F.lit(":"), F.col("source_node_id").cast("string"))
    ).select(F.lit(1).alias("invalid"))
    low_namespace = F.substring_index(F.col("node_id_low"), ":", 1)
    high_namespace = F.substring_index(F.col("node_id_high"), ":", 1)
    low_source_id = F.substring_index(F.col("node_id_low"), ":", -1).cast("long")
    high_source_id = F.substring_index(F.col("node_id_high"), ":", -1).cast("long")
    invalid_order = (
        (low_namespace != high_namespace)
        | (low_source_id.isNull())
        | (high_source_id.isNull())
        | (low_source_id >= high_source_id)
    )
    invalid_namespace = (low_namespace != F.col("dataset_id")) | (high_namespace != F.col("dataset_id"))
    invalid_edges = gold_edges.where(invalid_order | invalid_namespace).select(F.lit(1).alias("invalid"))

    node_ids = gold_nodes.select(F.col("node_id").alias("endpoint"))
    endpoints = gold_edges.select(F.col("node_id_low").alias("endpoint")).unionByName(
        gold_edges.select(F.col("node_id_high").alias("endpoint"))
    )
    dangling_endpoints = endpoints.join(node_ids, on="endpoint", how="left_anti").select(
        F.lit(1).alias("invalid")
    )
    invalid = invalid_nodes.unionByName(invalid_edges).unionByName(dangling_endpoints)
    if invalid.limit(1).count():
        raise GraphIntegrityError("Gold graph has invalid node IDs, edge ordering, or dangling endpoints")
