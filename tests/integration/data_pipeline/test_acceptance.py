from __future__ import annotations

import hashlib
import json
import multiprocessing
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pyspark.sql import SparkSession

from isn_etl.publication import (
    PublicationError,
    create_staging_directory,
    publish_staged_run,
    read_completed_run,
    write_run_manifest,
)


ROOT = Path(__file__).parents[2]
FIXTURES = ROOT / "fixtures" / "data_pipeline"
SOURCE = FIXTURES / "acceptance-edges.txt"
MANIFEST = FIXTURES / "acceptance-edges.manifest.json"
EXPECTED = FIXTURES / "acceptance-edges.expected.json"
_RUN_ID = "a" * 64


def _publish_race_worker(root: str, barrier: Any, results: Any) -> None:
    try:
        staging, final = create_staging_directory(Path(root), "acceptance-race", _RUN_ID)
        write_run_manifest(staging, {"run_id": _RUN_ID, "identity_sha256": "b" * 64})
        barrier.wait(timeout=20)
        publish_staged_run(staging, final, _RUN_ID)
        results.put("published")
    except PublicationError as error:
        results.put(f"rejected: {error}")


class FrozenAcceptanceFixtureTests(unittest.TestCase):
    def test_frozen_bytes_and_host_derived_identity_pins(self) -> None:
        expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
        content = SOURCE.read_bytes()
        self.assertFalse(content.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(content.endswith(b"\n"))
        self.assertNotIn(b"\r", content)
        self.assertEqual(hashlib.sha256(content).hexdigest(), expected["variants"]["lf"]["source_sha256"])
        self.assertEqual(len(content), expected["variants"]["lf"]["source_bytes"])
        lines = content.decode("utf-8", errors="strict").splitlines()
        self.assertEqual(len(lines), expected["line_count"])
        self.assertEqual([record["raw_text"] for record in expected["records"]], lines)

        identity = {
            "dataset_id": expected["dataset_id"],
            "source_version": expected["variants"]["lf"]["source_sha256"],
            "schema_version": expected["versions"]["schema"],
            "transform_version": expected["versions"]["transform"],
            "quality_policy_version": expected["versions"]["quality_policy"],
            "extra_config": {},
        }
        identity_bytes = json.dumps(
            identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        self.assertEqual(
            hashlib.sha256(identity_bytes).hexdigest(), expected["variants"]["lf"]["run_id"]
        )
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["source_sha256"], expected["variants"]["lf"]["source_sha256"])
        self.assertEqual(manifest["source_bytes"], len(content))
        for key, value in expected["expected_metadata"].items():
            self.assertEqual(manifest[key], value)

    def test_source_versions_and_run_metadata_change_identity(self) -> None:
        from isn_etl.provenance import load_manifest, stable_run_id

        manifest = load_manifest(MANIFEST)
        original_source = manifest.source_sha256
        original = stable_run_id(manifest, original_source)
        variants = json.loads(EXPECTED.read_text(encoding="utf-8"))["variants"]
        for name in ("crlf", "no_final_lf", "gzip"):
            self.assertNotEqual(original, stable_run_id(manifest, variants[name]["source_sha256"]))

        for override in (
            {"dataset_id": "isn-acceptance-renamed-v1"},
            {"schema_version": "1.0.1"},
            {"transform_version": "1.0.1"},
            {"quality_policy_version": "1.0.1"},
        ):
            data = json.loads(MANIFEST.read_text(encoding="utf-8"))
            data.update(override)
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "manifest.json"
                path.write_text(json.dumps(data), encoding="utf-8")
                self.assertNotEqual(original, stable_run_id(load_manifest(path), original_source))

    def test_frozen_record_id_fingerprints_are_independently_derived(self) -> None:
        expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
        cases = [
            (name, pin, expected["line_count"])
            for name, pin in expected["variants"].items()
        ]
        for name, pin in expected["additional_inputs"].items():
            if "record_ids_logical_sha256" not in pin:
                continue
            line_count = pin.get("line_count")
            if line_count is None and "raw_text" in pin:
                line_count = 1
            elif line_count is None and "expected_quarantine" in pin:
                line_count = max(record[0] for record in pin["expected_quarantine"])
            self.assertIsNotNone(line_count, f"{name} must freeze its source record count")
            cases.append((name, pin, line_count))

        for name, pin, line_count in cases:
            record_ids = [
                hashlib.sha256(
                    f"{pin['source_sha256']}\0{pin['source_file']}\0{line_number}".encode("utf-8")
                ).hexdigest()
                for line_number in range(1, line_count + 1)
            ]
            payload = ("\n".join(record_ids) + "\n").encode("utf-8")
            self.assertEqual(
                hashlib.sha256(payload).hexdigest(),
                pin["record_ids_logical_sha256"],
                f"{name} record-ID pin must derive from its frozen source identity",
            )


class PublicationConcurrencyAcceptanceTests(unittest.TestCase):
    def test_independent_publication_processes_have_one_safe_reservation_winner(self) -> None:
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory() as directory:
            barrier = context.Barrier(2)
            results = context.Queue()
            processes = [
                context.Process(target=_publish_race_worker, args=(directory, barrier, results))
                for _ in range(2)
            ]
            for process in processes:
                process.start()
            for process in processes:
                process.join(timeout=30)
            for process in processes:
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=5)
                self.assertEqual(process.exitcode, 0)

            outcomes = [results.get(timeout=5) for _ in processes]
            results.close()
            results.join_thread()
            self.assertEqual(outcomes.count("published"), 1)
            self.assertEqual(sum(value.startswith("rejected:") for value in outcomes), 1)
            final = Path(directory) / "acceptance-race" / "runs" / _RUN_ID
            self.assertEqual(
                read_completed_run(final, _RUN_ID),
                {"run_id": _RUN_ID, "identity_sha256": "b" * 64},
            )
            self.assertEqual(len(list(final.parent.glob(_RUN_ID))), 1)


def _spark_session() -> SparkSession:
    from pyspark.sql import SparkSession

    spark = (
        SparkSession.builder.master("local[2]")
        .appName("isn-b-publication-inventory-acceptance")
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


class SparkParquetInventoryAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spark = _spark_session()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.spark.stop()

    def test_reader_visible_unregistered_parquet_files_block_reuse(self) -> None:
        from isn_etl.pipeline import run_pipeline
        from isn_etl.schemas import SILVER_EDGES_SCHEMA

        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "published"
            result = run_pipeline(self.spark, SOURCE, MANIFEST, output_root)
            manifest_path = result.path / "_RUN_MANIFEST.json"
            original_manifest = manifest_path.read_bytes()

            table = result.path / "silver" / "edges"
            registered = next(table.glob("part-*.parquet"))
            rogue = table / "rogue.parquet"
            shutil.copyfile(registered, rogue)
            visible = self.spark.read.schema(SILVER_EDGES_SCHEMA).parquet(str(table))
            self.assertEqual(
                visible.count(),
                result.run_manifest["outputs"]["silver/edges"]["row_count"] * 2,
            )
            with self.assertRaisesRegex(PublicationError, "Spark-visible Parquet inventory"):
                run_pipeline(self.spark, SOURCE, MANIFEST, output_root)
            self.assertEqual(manifest_path.read_bytes(), original_manifest)
            rogue.unlink()

            outside_table = result.path / "unexpected" / "rogue.parquet"
            outside_table.parent.mkdir()
            shutil.copyfile(registered, outside_table)
            externally_visible = self.spark.read.schema(SILVER_EDGES_SCHEMA).parquet(
                str(outside_table.parent)
            )
            self.assertEqual(externally_visible.count(), result.run_manifest["outputs"]["silver/edges"]["row_count"])
            with self.assertRaisesRegex(PublicationError, "Spark-visible Parquet inventory"):
                run_pipeline(self.spark, SOURCE, MANIFEST, output_root)
            self.assertEqual(manifest_path.read_bytes(), original_manifest)


if __name__ == "__main__":
    unittest.main()
