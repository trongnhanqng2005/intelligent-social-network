[CmdletBinding()]
param(
    [string]$RunPath,
    [string]$OutputRoot,
    [string]$DatasetId = 'snap-facebook-combined',
    [ValidateRange(1, 100)]
    [int]$Limit = 5,
    [string]$Image = 'isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $OutputRoot) {
    $OutputRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'datasets/pipeline-output'
}

if (-not $RunPath) {
    $runsRoot = Join-Path $OutputRoot "$DatasetId\runs"
    if (-not (Test-Path -LiteralPath $runsRoot -PathType Container)) {
        throw "No runs directory found at: $runsRoot. Run './scripts/data-pipeline.ps1 run ...' first or specify -RunPath."
    }
    $completedMarker = Get-ChildItem -LiteralPath $runsRoot -Recurse -Filter '_COMPLETE.json' -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $completedMarker) {
        throw "No completed run (_COMPLETE.json) found under: $runsRoot"
    }
    $RunPath = $completedMarker.Directory.FullName
}

if (-not (Test-Path -LiteralPath (Join-Path $RunPath '_COMPLETE.json') -PathType Leaf)) {
    throw "Selected RunPath does not contain _COMPLETE.json: $RunPath"
}

$resolvedRunPath = (Resolve-Path -LiteralPath $RunPath).Path.Replace('\', '/')

$pyScript = @'
import json
import sys
from pathlib import Path
from pyspark.sql import SparkSession, functions as F

limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
base = Path('/run_out')
manifest = json.loads((base / '_RUN_MANIFEST.json').read_text(encoding='utf-8'))
complete = json.loads((base / '_COMPLETE.json').read_text(encoding='utf-8'))

print('=' * 80)
print(f"DATASET : {manifest.get('dataset_id')} ({manifest.get('source_file')})")
print(f"RUN ID  : {complete.get('run_id')}")
print(f"SAMPLE  : UNVERIFIED (completion marker/run-manifest integrity and full outputs not validated)")
print('=' * 80)

spark = (
    SparkSession.builder.master('local[2]')
    .appName('isn-b-inspect-parquet')
    .config('spark.ui.enabled', 'false')
    .config('spark.sql.codegen.factoryMode', 'NO_CODEGEN')
    .config('spark.sql.codegen.wholeStage', 'false')
    .getOrCreate()
)
spark.sparkContext.setLogLevel('ERROR')

print('\n=== 1. SILVER QUALITY METRICS ===')
spark.read.parquet(str(base / 'silver' / 'quality_metrics')).select(
    'stage', 'metric_name', 'value'
).orderBy('stage', 'metric_name').show(20, truncate=False)

print(f'=== 2. BRONZE RAW_EDGES (Top {limit} rows) ===')
spark.read.parquet(str(base / 'bronze' / 'raw_edges')).select(
    'line_number', 'raw_text', 'record_id', 'ingested_at'
).orderBy('line_number').show(limit, truncate=False)

print(f'=== 3. SILVER QUARANTINE (Top {limit} rows) ===')
spark.read.parquet(str(base / 'silver' / 'quarantine')).select(
    'line_number', 'raw_text', 'reason_code'
).orderBy('line_number').show(limit, truncate=False)

print(f'=== 4. SILVER EDGES (Top {limit} rows) ===')
spark.read.parquet(str(base / 'silver' / 'edges')).select(
    'source_node_id_low', 'source_node_id_high', 'source_record_count'
).orderBy('source_node_id_low', 'source_node_id_high').show(limit, truncate=False)

print(f'=== 5. GOLD NODES (Top {limit} rows) ===')
spark.read.parquet(str(base / 'gold' / 'nodes')).select(
    'node_id', 'source_node_id'
).orderBy('source_node_id').show(limit, truncate=False)

print(f'=== 6. GOLD EDGES (Top {limit} rows) ===')
edges = spark.read.parquet(str(base / 'gold' / 'edges'))
edges.select('node_id_low', 'node_id_high').orderBy('node_id_low', 'node_id_high').show(limit, truncate=False)

print(f'=== 7. TOP {limit} MOST CONNECTED NODES (DEGREE IN GOLD GRAPH) ===')
deg = (
    edges.select(F.col('node_id_low').alias('node_id'))
    .unionAll(edges.select(F.col('node_id_high').alias('node_id')))
    .groupBy('node_id')
    .count()
    .withColumnRenamed('count', 'degree')
    .orderBy(F.desc('degree'), F.asc('node_id'))
)
deg.show(limit, truncate=False)

spark.stop()
'@.Replace('"', '\"')

& docker run --rm --platform linux/amd64 --cpus=2 --memory=1536m --memory-swap=1536m `
    --pids-limit=256 --network none --hostname isn-etl `
    --add-host isn-etl:127.0.0.1 `
    --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 `
    --tmpfs /run/isn-etl-snappy:rw,exec,nosuid,nodev,size=64m,mode=0700,uid=10001,gid=10001 `
    --mount "type=bind,source=$resolvedRunPath,target=/run_out,readonly" `
    --env "JAVA_TOOL_OPTIONS=-Dorg.xerial.snappy.tempdir=/run/isn-etl-snappy -XX:ActiveProcessorCount=2" `
    --env "PYSPARK_SUBMIT_ARGS=--driver-memory 512m pyspark-shell" `
    --entrypoint python $Image -c $pyScript "$Limit"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
