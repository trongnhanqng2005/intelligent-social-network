from __future__ import annotations

import argparse
import json
import os
import platform
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence

import py4j
import pyspark
from pyspark.sql import SparkSession
from pyspark.sql.types import LongType, StringType, StructField, StructType

from isn_etl.pipeline import run_pipeline
from isn_etl.provenance import load_manifest, validate_source


def _spark_session(app_name: str) -> SparkSession:
    spark = (
        SparkSession.builder.master("local[2]")
        .appName(app_name)
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


def _doctor() -> None:
    if os.name != "posix" or platform.system() != "Linux":
        raise RuntimeError("Docker runtime doctor requires Linux")
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError(f"Python 3.12 is required, found {sys.version.split()[0]}")
    if pyspark.__version__ != "3.5.9" or py4j.__version__ != "0.10.9.7":
        raise RuntimeError(f"Unexpected Spark runtime: PySpark {pyspark.__version__}, Py4J {py4j.__version__}")
    dependency_check = subprocess.run(
        [sys.executable, "-m", "pip", "check"],
        check=False,
        capture_output=True,
        text=True,
    )
    if dependency_check.returncode != 0:
        raise RuntimeError(f"Dependency integrity check failed: {dependency_check.stdout}{dependency_check.stderr}")

    snappy_tmp = Path(os.environ["SNAPPY_NATIVE_TMPDIR"])
    snappy_stat = snappy_tmp.stat()
    if stat.S_IMODE(snappy_stat.st_mode) != 0o700 or snappy_stat.st_uid != os.getuid():
        raise RuntimeError(
            f"Snappy temp directory must be mode 0700 and owned by this user: "
            f"mode={stat.S_IMODE(snappy_stat.st_mode):04o}, uid={snappy_stat.st_uid}"
        )
    mount = next(
        (line.split() for line in Path("/proc/mounts").read_text(encoding="utf-8").splitlines()
         if line.split()[1] == str(snappy_tmp)),
        None,
    )
    if mount is None or mount[2] != "tmpfs" or "noexec" in mount[3].split(","):
        raise RuntimeError(f"Snappy path is not an executable tmpfs mount: {mount}")

    spark = _spark_session("isn-b-runtime-doctor")
    try:
        jvm = spark.sparkContext._jvm
        java_version = jvm.java.lang.System.getProperty("java.version")
        snappy_property = jvm.java.lang.System.getProperty("org.xerial.snappy.tempdir")
        if not java_version.startswith("17."):
            raise RuntimeError(f"Java 17 is required, found {java_version}")
        if jvm.java.lang.Runtime.getRuntime().availableProcessors() != 2:
            raise RuntimeError("Java must observe the approved two-CPU container limit")
        if snappy_property != str(snappy_tmp):
            raise RuntimeError(f"JVM Snappy tempdir mismatch: {snappy_property}")
        if spark.sparkContext.master != "local[2]":
            raise RuntimeError(f"Spark master must be local[2], found {spark.sparkContext.master}")

        worker_result = (
            spark.sparkContext.parallelize([1, 2, 3, 4], 2)
            .map(lambda value: (value, value * value))
            .collect()
        )
        if worker_result != [(1, 1), (2, 4), (3, 9), (4, 16)]:
            raise RuntimeError(f"Python worker returned unexpected values: {worker_result}")

        schema = StructType(
            [
                StructField("id", LongType(), nullable=False),
                StructField("label", StringType(), nullable=False),
            ]
        )
        expected_rows = [(1, "alpha"), (2, "beta")]
        frame = spark.createDataFrame(expected_rows, schema)
        if frame.schema != schema:
            raise RuntimeError(f"Source DataFrame schema mismatch: {frame.schema.json()}")

        with tempfile.TemporaryDirectory(prefix="isn-etl-doctor-") as temporary:
            output = Path(temporary) / "parquet"
            frame.coalesce(1).write.mode("errorifexists").option("compression", "snappy").parquet(
                str(output)
            )
            parquet_files = sorted(output.glob("part-*.parquet"))
            if len(parquet_files) != 1:
                raise RuntimeError(f"Expected one Parquet file, found: {parquet_files}")
            footer = jvm.org.apache.parquet.hadoop.ParquetFileReader.readFooter(
                spark.sparkContext._jsc.hadoopConfiguration(),
                jvm.org.apache.hadoop.fs.Path(str(parquet_files[0])),
            )
            codecs = {
                column.getCodec().name()
                for block in footer.getBlocks()
                for column in block.getColumns()
            }
            if codecs != {"SNAPPY"}:
                raise RuntimeError(f"Parquet footer does not confirm Snappy: {codecs}")

            readback = spark.read.parquet(str(output))
            if [field.name for field in readback.schema.fields] != ["id", "label"]:
                raise RuntimeError(f"Parquet column names/order mismatch: {readback.schema.json()}")
            if [field.dataType.json() for field in readback.schema.fields] != [
                field.dataType.json() for field in schema.fields
            ]:
                raise RuntimeError(f"Parquet logical types mismatch: {readback.schema.json()}")
            if [field.metadata for field in readback.schema.fields] != [
                field.metadata for field in schema.fields
            ]:
                raise RuntimeError(f"Parquet metadata mismatch: {readback.schema.json()}")
            if not all(field.nullable for field in readback.schema.fields):
                raise RuntimeError(f"Unexpected Parquet read nullability: {readback.schema.json()}")
            rows = [tuple(row) for row in readback.orderBy("id").collect()]
            if readback.count() != len(expected_rows) or rows != expected_rows:
                raise RuntimeError(f"Parquet data mismatch: count={readback.count()}, rows={rows}")
            null_counts = {
                field.name: readback.where(readback[field.name].isNull()).count()
                for field in readback.schema.fields
            }
            if null_counts != {"id": 0, "label": 0}:
                raise RuntimeError(f"Parquet read-back contains nulls: {null_counts}")

        native_libraries = sorted(snappy_tmp.glob("snappy-1.1.10-*-libsnappyjava.so"))
        if not native_libraries:
            raise RuntimeError(f"Snappy native library was not extracted under {snappy_tmp}")

        print(f"Linux: {platform.release()} {platform.machine()}")
        print(f"Python: {sys.version.split()[0]}")
        print(f"PySpark: {pyspark.__version__}; Py4J: {py4j.__version__}")
        print(f"Dependency check: PASS ({dependency_check.stdout.strip()})")
        print(f"Java: {java_version}; Spark: {spark.version}; master={spark.sparkContext.master}")
        print(f"Snappy mount: tmpfs {mount[3]}; mode=0700; uid={snappy_stat.st_uid}; JVM property={snappy_property}")
        print(f"Python worker: PASS {worker_result}")
        print(f"Snappy Parquet footer/readback: PASS codec={sorted(codecs)} rows={rows} nulls={null_counts}")
        print("DOCKER_SPARK_PARQUET_SMOKE=PASS")
    finally:
        spark.stop()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="isn-etl")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="verify the pinned Docker Spark and Snappy runtime")

    prepare = commands.add_parser(
        "prepare-source",
        help="verify a local source against its approved manifest; never downloads or creates pins",
    )
    prepare.add_argument("--source", type=Path, required=True)
    prepare.add_argument("--manifest", type=Path, required=True)

    run = commands.add_parser("run", help="run Bronze, Silver/quarantine, and Gold for a verified source")
    run.add_argument("--source", type=Path, required=True)
    run.add_argument("--manifest", type=Path, required=True)
    run.add_argument("--output-root", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            _doctor()
            return 0
        if args.command == "prepare-source":
            manifest = load_manifest(args.manifest)
            source = validate_source(args.source, manifest)
            print(
                json.dumps(
                    {
                        "status": "verified",
                        "dataset_id": manifest.dataset_id,
                        "source": str(source.source_path),
                        "rights_status": manifest.rights_status,
                        "source_sha256": source.source_sha256,
                        "uncompressed_sha256": source.uncompressed_sha256,
                        "source_bytes": source.source_bytes,
                        "content_bytes": source.content_bytes,
                        "acquired_at": manifest.acquired_at,
                        "records": len(source.records),
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0

        spark = _spark_session("isn-b-graph-ingestion")
        try:
            result = run_pipeline(spark, args.source, args.manifest, args.output_root)
        finally:
            spark.stop()
        print(
            json.dumps(
                {
                    "status": "reused" if result.reused else "published",
                    "run_id": result.run_id,
                    "path": str(result.path),
                    "metrics": result.run_manifest["metrics"],
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"isn-etl {args.command} failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
