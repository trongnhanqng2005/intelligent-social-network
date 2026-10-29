from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from pyspark.sql import SparkSession
from pyspark.sql.types import StructType

from isn_etl.pipeline import PipelineError, run_pipeline
from isn_etl.provenance import load_manifest, stable_run_id, validate_source
from isn_etl.publication import PublicationError, read_completed_run
from isn_etl.schemas import (
    GOLD_EDGES_SCHEMA,
    GOLD_NODES_SCHEMA,
    QUALITY_METRICS_SCHEMA,
    SILVER_EDGES_SCHEMA,
)


TEST_ROOT = Path(__file__).parents[2]
FIXTURE_ROOT = TEST_ROOT / "fixtures" / "data_pipeline"
FIXTURE_SOURCE = FIXTURE_ROOT / "synthetic-edges.txt"
FIXTURE_MANIFEST = FIXTURE_ROOT / "synthetic-edges.manifest.json"


def schema_contract(actual: object, names: list[str], types: list[str]) -> None:
    fields = actual.fields
    assert [field.name for field in fields] == names
    assert [field.dataType.simpleString() for field in fields] == types


def read_table(spark: SparkSession, path: Path, schema: StructType):
    return spark.read.schema(schema).parquet(str(path))


def create_spark_session() -> SparkSession:
    spark = (
        SparkSession.builder.master("local[2]")
        .appName("isn-b-data-pipeline-integration")
        .config("spark.ui.enabled", "false")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.warehouse.dir", "/tmp/spark-warehouse")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.sql.codegen.factoryMode", "NO_CODEGEN")
        .config("spark.sql.codegen.wholeStage", "false")
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


def write_manifest(source_path: Path, directory: Path, *, rights_status: str = "synthetic") -> Path:
    source_bytes = source_path.read_bytes()
    content = gzip.decompress(source_bytes) if source_path.suffix == ".gz" else source_bytes
    source_format = "gzip" if source_path.suffix == ".gz" else "plain"
    manifest = {
        "manifest_version": 1,
        "dataset_id": "integration-fixture",
        "source_file": source_path.name,
        "source_format": source_format,
        "graph_semantics": "undirected_edge_list",
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "uncompressed_sha256": hashlib.sha256(content).hexdigest(),
        "source_bytes": len(source_bytes),
        "content_bytes": len(content),
        "acquired_at": None,
        "source_url": "https://example.invalid/synthetic" if rights_status == "approved" else None,
        "citation": "Original synthetic integration fixture.",
        "rights_status": rights_status,
        "rights_evidence": "Owner-approved test fixture." if rights_status == "approved" else "Authored test bytes.",
        "schema_version": "1.0.0",
        "transform_version": "1.0.0",
        "quality_policy_version": "1.0.0",
        "expected_reference_counts": None,
    }
    manifest_path = directory / f"{source_path.stem}.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest_path


class SparkPipelineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spark = create_spark_session()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.spark.stop()

    def test_pipeline_layers_quality_provenance_reuse_and_repeatability(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_root = root / "published"
            result = run_pipeline(self.spark, FIXTURE_SOURCE, FIXTURE_MANIFEST, output_root)

            self.assertFalse(result.reused)
            self.assertTrue((result.path / "_COMPLETE.json").is_file())
            completed_manifest = read_completed_run(result.path, result.run_id)
            self.assertEqual(completed_manifest["dataset_id"], "isn-synthetic-edges-v1")
            self.assertEqual(completed_manifest["source_sha256"], completed_manifest["source_version"])
            self.assertEqual(completed_manifest["rights_status"], "synthetic")
            self.assertEqual(completed_manifest["graph_semantics"], "undirected_edge_list")
            self.assertEqual(completed_manifest["source_bytes"], 101)
            self.assertEqual(completed_manifest["content_bytes"], 101)
            self.assertIsNone(completed_manifest["acquired_at"])
            self.assertEqual(completed_manifest["runtime"]["pyspark"], "3.5.9")
            self.assertRegex(completed_manifest["runtime"]["code_sha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(completed_manifest["runtime"]["dependency_lock_sha256"], r"^[0-9a-f]{64}$")

            silver_edges = read_table(self.spark, result.path / "silver" / "edges", SILVER_EDGES_SCHEMA)
            schema_contract(
                silver_edges.schema,
                ["dataset_id", "source_version", "source_node_id_low", "source_node_id_high", "source_record_count"],
                ["string", "string", "bigint", "bigint", "bigint"],
            )
            edge_rows = [
                (row.source_node_id_low, row.source_node_id_high, row.source_record_count)
                for row in silver_edges.collect()
            ]
            edge_rows.sort()
            self.assertEqual(edge_rows, [(0, 1, 1), (1, 2, 3)])
            self.assertTrue(all(low < high for low, high, _ in edge_rows))

            gold_nodes = read_table(self.spark, result.path / "gold" / "nodes", GOLD_NODES_SCHEMA)
            schema_contract(
                gold_nodes.schema,
                ["dataset_id", "source_version", "node_id", "source_node_id"],
                ["string", "string", "string", "bigint"],
            )
            self.assertEqual(
                sorted(row.node_id for row in gold_nodes.collect()),
                [
                    "isn-synthetic-edges-v1:0",
                    "isn-synthetic-edges-v1:1",
                    "isn-synthetic-edges-v1:2",
                ],
            )
            gold_edges = read_table(self.spark, result.path / "gold" / "edges", GOLD_EDGES_SCHEMA)
            gold_edge_rows = gold_edges.collect()
            self.assertEqual(
                sorted((row.node_id_low, row.node_id_high) for row in gold_edge_rows),
                [("isn-synthetic-edges-v1:0", "isn-synthetic-edges-v1:1"),
                 ("isn-synthetic-edges-v1:1", "isn-synthetic-edges-v1:2")],
            )

            quality = read_table(self.spark, result.path / "silver" / "quality_metrics", QUALITY_METRICS_SCHEMA)
            metrics = {(row.stage, row.metric_name): row.value for row in quality.collect()}
            self.assertEqual(metrics[("bronze", "total_records")], 10)
            self.assertEqual(metrics[("bronze", "blank_records")], 1)
            self.assertEqual(metrics[("bronze", "comment_records")], 1)
            self.assertEqual(metrics[("bronze", "candidate_records")], 8)
            self.assertEqual(metrics[("silver", "quarantined_records")], 4)
            self.assertEqual(metrics[("silver", "valid_edge_occurrences")], 4)
            self.assertEqual(metrics[("silver", "unique_edges")], 2)
            self.assertEqual(metrics[("silver", "duplicate_excess")], 2)
            self.assertEqual(metrics[("silver", "observed_nodes")], 3)
            self.assertEqual(metrics[("gold", "nodes")], 3)
            self.assertEqual(metrics[("gold", "edges")], 2)

            before = (result.path / "_RUN_MANIFEST.json").read_bytes()
            repeated = run_pipeline(self.spark, FIXTURE_SOURCE, FIXTURE_MANIFEST, output_root)
            self.assertTrue(repeated.reused)
            self.assertEqual(repeated.run_id, result.run_id)
            self.assertEqual((result.path / "_RUN_MANIFEST.json").read_bytes(), before)

            parquet_file = next((result.path / "gold" / "nodes").glob("part-*.parquet"))
            parquet_bytes = parquet_file.read_bytes()
            parquet_file.write_bytes(parquet_bytes + b"tampered")
            try:
                with self.assertRaisesRegex(PublicationError, "hash mismatch"):
                    run_pipeline(self.spark, FIXTURE_SOURCE, FIXTURE_MANIFEST, output_root)
            finally:
                parquet_file.write_bytes(parquet_bytes)

            second_root = root / "independent"
            self.spark.stop()
            type(self).spark = create_spark_session()
            independent = run_pipeline(self.spark, FIXTURE_SOURCE, FIXTURE_MANIFEST, second_root)
            self.assertEqual(
                completed_manifest["outputs"]["silver/edges"]["logical_sha256"],
                independent.run_manifest["outputs"]["silver/edges"]["logical_sha256"],
            )
            self.assertEqual(
                completed_manifest["outputs"]["gold/nodes"]["logical_sha256"],
                independent.run_manifest["outputs"]["gold/nodes"]["logical_sha256"],
            )

    def test_rights_checksum_and_empty_graph_fail_without_completion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "source"
            source_root.mkdir()
            unresolved_path = source_root / "facebook_combined.txt.gz"
            unresolved_path.write_bytes(gzip.compress(b"1 2\n", mtime=0))
            unresolved_manifest = source_root / "snap.manifest.json"
            unresolved_manifest.write_text(
                json.dumps(
                    {
                        "manifest_version": 1,
                        "dataset_id": "snap-facebook-combined",
                        "source_file": unresolved_path.name,
                        "source_format": "gzip",
                        "graph_semantics": "undirected_edge_list",
                        "source_sha256": None,
                        "uncompressed_sha256": None,
                        "source_bytes": None,
                        "content_bytes": None,
                        "acquired_at": None,
                        "source_url": "https://snap.stanford.edu/data/facebook_combined.txt.gz",
                        "citation": "SNAP source candidate; rights not cleared.",
                        "rights_status": "unresolved",
                        "rights_evidence": None,
                        "schema_version": "1.0.0",
                        "transform_version": "1.0.0",
                        "quality_policy_version": "1.0.0",
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "rights|approved"):
                run_pipeline(self.spark, unresolved_path, unresolved_manifest, root / "unresolved")
            self.assertFalse((root / "unresolved").exists())

            tampered = source_root / "synthetic-edges.txt"
            tampered.write_text("1 3\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                run_pipeline(self.spark, tampered, FIXTURE_MANIFEST, root / "tampered")
            self.assertFalse((root / "tampered").exists())

            empty_source = source_root / "blank-only.txt"
            empty_source.write_bytes(b"\n")
            empty_manifest = write_manifest(empty_source, source_root)
            output_root = root / "empty-graph"
            with self.assertRaisesRegex(ValueError, "edge|empty|quality"):
                run_pipeline(self.spark, empty_source, empty_manifest, output_root)
            self.assertFalse(list(output_root.glob("**/_COMPLETE.json")))

    def test_incomplete_destination_is_never_reused_or_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = load_manifest(FIXTURE_MANIFEST)
            source = validate_source(FIXTURE_SOURCE, manifest)
            run_id = stable_run_id(manifest, source.source_version)
            final = root / "isn-synthetic-edges-v1" / "runs" / run_id
            final.mkdir(parents=True)
            sentinel = final / "partial.bin"
            sentinel.write_bytes(b"preserve")

            with self.assertRaises(PublicationError):
                run_pipeline(self.spark, FIXTURE_SOURCE, FIXTURE_MANIFEST, root)
            self.assertEqual(sentinel.read_bytes(), b"preserve")
            with self.assertRaises(PublicationError):
                read_completed_run(final, run_id)


if __name__ == "__main__":
    unittest.main()
