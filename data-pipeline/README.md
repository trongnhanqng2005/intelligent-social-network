# Standalone graph-edge ETL

> **Current status (2026-11-19)** Standalone ETL is implemented. The pinned Java 17.0.21 image built successfully. Current Doctor and synthetic full-driver acceptance remain pending a safe launch. Independent verification covers the preserved SNAP publication. Real-source reproduction remains pending verification of the applicable data-use terms. See the [acceptance report](../tests/integration/data_pipeline/acceptance.md).

This folder contains the approved, standalone PySpark batch pipeline. It processes a locally supplied, manifest-pinned undirected edge list into Bronze, Silver/quarantine, and Gold Parquet. It has no API, Neo4j, live-user, event-generation, feature-engineering, model-training, or serving integration.

## Status and source gate

The SNAP manifest records SHA-256 and byte-size pins and a declared rights decision. Independent checks verified source hashes and all eight Parquet schemas, rows and logical hashes of the preserved publication. The dataset page and a coauthor’s download and citation guidance establish the source and expected attribution. The scope for reuse and retention of derived outputs remains unverified. The [acceptance report](../tests/integration/data_pipeline/acceptance.md) records the evidence and current runtime.

Only original synthetic data under `tests/fixtures/data_pipeline/` is used by the committed tests. Do not put source datasets or generated Parquet in Git.

## Runtime and commands

The launcher requires a matching local image and does not pull, build, or install anything implicitly. The default legacy tag is not a current candidate runtime. The acceptance driver can be given an independently pinned full image ID via `-CandidateImageId sha256:<64 hex>`; this does not waive Docker Doctor's Java/version, runtime user, platform, or per-launch checks. Container invocations are offline, run as UID 10001, limited to 2 CPUs, 4 GiB RAM, and 256 PIDs, and use a per-invocation executable Snappy tmpfs (0700, UID/GID 10001). Source, manifest and repository mounts are read-only; `run` receives only its selected output-root mount as writable. Containers use `--rm` and stop Spark before exit.

Run from the repository root in PowerShell:

```powershell
scripts/data-pipeline.ps1 doctor
scripts/data-pipeline.ps1 test-unit
scripts/data-pipeline.ps1 test-integration
scripts/data-pipeline.ps1 prepare-source `
  -Source tests/fixtures/data_pipeline/synthetic-edges.txt `
  -Manifest tests/fixtures/data_pipeline/synthetic-edges.manifest.json
scripts/data-pipeline.ps1 run `
  -Source tests/fixtures/data_pipeline/synthetic-edges.txt `
  -Manifest tests/fixtures/data_pipeline/synthetic-edges.manifest.json `
  -OutputRoot D:/temp/opencode/isn-b-etl-output
```

`doctor` runs a real Spark worker and Snappy-compressed Parquet round-trip, checking the Parquet footer, schema contract, row values and nulls, then stops Spark. `prepare-source` verifies a local file against an already supplied manifest; it does not create pins or acquire the source. A new `run` validates every Parquet footer and read-back row, required-field nulls, logical hashes, quality accounting and graph integrity before publication. Reuse verifies the marker, runtime/code/lock fingerprints, registered Parquet file sizes and hashes, and the complete Spark-visible Parquet data-file set (including names outside Spark's normal `part-*.parquet` output pattern). Unexpected visible Parquet files are rejected before reuse. Output paths are `<output-root>/<dataset_id>/runs/<run_id>/`.

## Input manifests and memory scope

Manifest version 1 is JSON. It pins the dataset ID, basename, `plain`/`gzip` format, `undirected_edge_list` semantics, compressed and decompressed SHA-256, byte sizes, citation, rights decision/evidence, optional URL/acquisition timestamp, and schema/transform/quality-policy versions. External sources require `rights_status: approved`, evidence, URL, acquisition time, checksums and sizes. Synthetic fixtures use `rights_status: synthetic`. The accepted compressed source is read-only.

The current implementation validates the full compressed/decompressed source and logical lines in the Python driver before creating Bronze. It is intended for the selected small static graph, not arbitrary large data or cluster-scale ingestion. A future streaming/distributed source reader would need its own approved design and reproducibility tests.

## Publication behavior

Each run receives a unique `.staging/<dataset_id>/...` directory. All Parquet outputs and their required schemas, non-null values, logical hashes, quality counts and endpoint relationships are checked before a run manifest is written. Publication reserves the final run path without overwriting, moves each staged child into that path, and writes `_COMPLETE.json` last. The marker includes the SHA-256 of `_RUN_MANIFEST.json`; consumers must require it and verify listed outputs. A failed run is left incomplete for diagnosis and is never reused. There is no automatic cleanup or overwrite.

This is completion-marker publication, not an atomic whole-directory transaction. Windows hosts invoke Spark in Docker Desktop Linux with a bind-mounted output directory; cross-platform rename/durability guarantees are not claimed. If a process is interrupted, inspect the incomplete final/staging paths before any operator-owned cleanup.

See [the ingestion/run contract](../docs/big-data/ingestion-etl.md), [source provenance](../docs/big-data/dataset-provenance.md), and [Parquet schemas](../docs/big-data/parquet-contracts.md).

## Bàn giao kỹ thuật ISN-B

### Mục tiêu và ranh giới

ISN-B chuẩn bị dữ liệu đồ thị cạnh vô hướng từ file cục bộ để các bước phân tích/ML sau này có thể sử dụng hợp đồng Parquet rõ ràng. Đây là batch standalone, không gọi NestJS, không đọc/ghi Neo4j, không kết nối Posts & Feed, không huấn luyện hay phục vụ mô hình và không xử lý sự kiện người dùng. `node_id` ở Gold là định danh phân tích theo dataset, **không phải** UUID User của ứng dụng. Không suy diễn nghiệm thu synthetic thành nghiệm thu SNAP hoặc production readiness.

Image build hiện tại ghi nhận Docker Desktop Linux/amd64, Python 3.12.15, PySpark 3.5.9, Py4J 0.10.9.7 và OpenJDK 17.0.21+9. Cần lượt Doctor trên đúng image để xác minh Spark `local[2]` và Snappy Parquet. Python và build dependencies được ghim bằng SHA-256 trong các lock file.

### Mã nguồn và luồng xử lý

| Thành phần | Trách nhiệm |
|---|---|
| `src/isn_etl/cli.py`, `scripts/data-pipeline.ps1` | CLI, Spark session và launcher Docker. |
| `provenance.py` | Kiểm tra manifest, quyền sử dụng, kích thước/hash source và nội dung giải nén, UTF-8 và identity. |
| `bronze.py`, `silver.py`, `gold.py`, `schemas.py` | Các tầng biến đổi và schema Spark tường minh. |
| `pipeline.py`, `publication.py` | Kiểm tra read-back, metrics, inventory và công bố marker-last; từ chối ghi đè/reuse sai. |
| `tests/fixtures/data_pipeline/`, `tests/unit/data_pipeline/`, `tests/integration/data_pipeline/` | Fixture synthetic nhỏ, unit tests, kiểm thử Spark và acceptance driver/verifier. |

Đầu vào là file UTF-8 edge list `plain` hoặc `gzip` được cung cấp cục bộ, kèm manifest v1. `prepare-source` kiểm tra pin có sẵn, không tải file hay tự tạo pin. Với nguồn ngoài, quyền, bằng chứng và pin đáng tin cậy phải được phê duyệt; cấu hình SNAP hiện cố ý bị chặn.

1. **Bronze:** `raw_edges` lưu từng dòng logic, tên nguồn, số dòng và `record_id`; `source_metadata` lưu provenance, hash, kích thước và phiên bản. Dòng trống/comment/lỗi vẫn được giữ ở Bronze.
2. **Silver:** mỗi cạnh hợp lệ có đúng hai số thập phân ASCII không dấu trong miền `0..2^63-1`; chuẩn hóa đầu mút theo thứ tự số `min/max`. Self-loop, sai số cột, ID không hợp lệ hoặc vượt miền vào quarantine với reason code; comment/dòng trống được đếm riêng. Cạnh đảo chiều và lặp gộp thành một cạnh với `source_record_count`; nodes chỉ gồm đầu mút quan sát được. Metrics kiểm tra cân bằng số dòng/cạnh.
3. **Gold:** nodes có `node_id` dạng `<dataset_id>:<source_node_id>` và edges dùng các ID đó theo thứ tự số nguồn. Chi tiết trường, type, nullability và quy tắc kiểm tra nằm ở [hợp đồng Parquet](../docs/big-data/parquet-contracts.md).

`source_version` là SHA-256 bytes nguồn; `record_id` phụ thuộc source version, basename và số dòng; `run_id` phụ thuộc source và phiên bản hợp đồng/cấu hình. Manifest output lưu schema, số dòng, file inventory/hash và logical SHA-256: Spark-JSON theo schema, sắp xếp chuỗi rồi thêm một LF cho mỗi dòng; bảng rỗng hash zero byte. Silver/Gold được kỳ vọng tái lập logic khi điều kiện identity tương đương; timestamp Bronze và bytes Parquet không được hứa giống nhau. Xem [provenance](../docs/big-data/dataset-provenance.md) để phân biệt các identity và giới hạn.

Trước marker, pipeline đọc lại Parquet, kiểm schema, null, metrics, integrity và file inventory. `_RUN_MANIFEST.json` ghi kết quả; `_COMPLETE.json` ghi hash manifest và được tạo cuối. Reuse kiểm tra identity/runtime, marker và hash/inventory file, không đọc lại toàn bộ rows bằng Spark. Output thiếu marker hoặc xung đột bị từ chối, không bị ghi đè. Đây không phải atomic transaction toàn thư mục; pipeline **không tự xóa** output/staging lỗi. Người vận hành cần kiểm tra và bảo toàn trước khi cleanup có chủ đích.

### Nhận branch và chuẩn bị môi trường

```powershell
git clone https://github.com/trongnhanqng2005/intelligent-social-network.git
cd intelligent-social-network
git fetch origin feature/data-ingestion-spark-etl
git switch -c feature/data-ingestion-spark-etl --track origin/feature/data-ingestion-spark-etl
```

Cần Docker Desktop Linux/amd64, PowerShell, Python 3.12 và quyền truy cập artifact dependencies đã pin. Launcher yêu cầu image local `isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy`; **không** tự tải, build hoặc cài dependency. Wheelhouse không nằm trong Git và `data-pipeline/.dockerignore` không đưa wheelhouse vào context mặc định. Trên máy mới, có thể tiếp nhận image task-owned đã được kiểm chứng qua kênh nội bộ, hoặc chuẩn bị wheelhouse và build context riêng như sau (cần mạng/registry được phép; build chưa được chạy lại trong lượt bàn giao này):

```powershell
$ctx = Join-Path $PWD '.artifacts/data-pipeline-build-context'
if (Test-Path $ctx) { throw 'Build context đã tồn tại; chọn đường dẫn mới, không ghi đè.' }
New-Item -ItemType Directory -Path "$ctx/wheelhouse" -Force | Out-Null
Copy-Item data-pipeline/Dockerfile, data-pipeline/pyproject.toml, data-pipeline/requirements.lock, data-pipeline/requirements-build.lock -Destination $ctx
python -m pip download --no-deps --require-hashes -r data-pipeline/requirements-build.lock -d "$ctx/wheelhouse"
python -m pip download --no-deps --require-hashes -r data-pipeline/requirements.lock -d "$ctx/wheelhouse"
docker build --platform linux/amd64 --target runtime -t isn-b-data-pipeline:py3.12-pyspark3.5.9-runtime-snappy $ctx
```

Dùng Python 3.12 cho `pip download`; các distribution phải khớp hash trong lock. Nếu image base hoặc phiên bản OpenJDK ghim không còn khả dụng, dừng và xử lý provenance/dependency, không tự đổi pin. Image build mới có thể khác image ID lịch sử; full-driver hiện kiểm identity và baseline nghiêm ngặt, không tự coi image mới tương đương. Không đưa wheelhouse, image, logs, Parquet, `.env` hoặc artifact local lên Git.

Các lệnh launcher thực tế ở mục **Runtime and commands** phía trên. `prepare-source` không khởi tạo Spark nhưng vẫn cần Docker/image; `test-unit` chạy unit trong container, còn `doctor`, `run`, `test-integration` và independent verifier có Spark/Parquet workload. **Launcher trực tiếp không tự áp dụng gate RAM của acceptance driver**: trước mọi workload Spark của nghiệm thu phải áp dụng preflight và gate 4,5 GiB tức thời, giữ tuần tự và dừng khi không đạt. Không dùng một mẫu RAM cũ để cấp phép. Không chạy hai Spark đồng thời nếu chưa xác nhận an toàn.

`run` ghi dưới `<OutputRoot>/<dataset_id>/runs/<run_id>/`; manifest và marker nằm ở run root, các bảng nằm trong thư mục Bronze/Silver/Gold. Driver nghiệm thu `tests/integration/data_pipeline/acceptance.ps1` ghi báo cáo/log dưới root invocation riêng; có tham số `-ArtifactBase`, `-VariantFixtureRoot`, `-HistoricalBaseline`, `-ProtectedInventory`, `-CandidateImageId`, `-Image` và `-DoctorEvidencePath`. Explicit `-ProtectedInventory` selects fresh mode and requires `-CandidateImageId`; it does not require or read `-HistoricalBaseline`. Không tái sử dụng Doctor evidence không còn khớp fingerprint.

### Tiến độ và việc tiếp quản

| Trạng thái | Hạng mục |
|---|---|
| DONE | Code ETL, CLI, contract synthetic, kiểm tra publication/reuse; sửa hash bảng rỗng với regression. |
| DONE | Lượt kiểm tra nhẹ sau sửa: 26/26 unit, 7/7 verifier schema/hash; gate resource và monitoring tests PASS. |
| IN PROGRESS | Synthetic Acceptance: tám fixture đã được phục hồi và kiểm tra độc lập; fresh preservation inventory không thay thế artifact lịch sử vắng mặt. |
| BLOCKED | Full-driver PASS, current Doctor và RAM gate chưa đạt; SNAP chưa có quyền/pin tin cậy. Legacy historical baseline/marker/manifests/reports cũ còn thiếu; fresh mode có inventory riêng. |
| NOT STARTED | Independent Code Review; nghiệm thu và quyết định merge của Owner. |

Ưu tiên tiếp theo:

1. **Khôi phục input:** cả tám fixture đóng băng đã được phục hồi và kiểm tra độc lập; điều này không tái tạo marker/manifest lịch sử.
2. **Chuẩn bị evidence:** inventory bền vững `D:\DoAn\BigData\_isn-b-artifacts\weylume-acceptance-20261119\fresh-preservation-baseline.json` và `recovered-synthetic-20261119` sibling là preservation evidence mới, không phải historical baseline; không hàm ý artifact vắng mặt đã được tạo lại.
3. **Run acceptance:** dùng `-ProtectedInventory D:/DoAn/BigData/_isn-b-artifacts/weylume-acceptance-20261119/fresh-preservation-baseline.json -CandidateImageId sha256:<64 hex>` cho fresh mode, không yêu cầu/đọc historical baseline. Legacy mode không có `-ProtectedInventory` vẫn yêu cầu baseline lịch sử và xác minh image identity. Full-driver PASS, current Doctor, per-launch resource gates và independent current-candidate verification vẫn outstanding.
4. **Resource:** chỉ chạy serial khi Docker/image, môi trường và RAM tức thời đạt toàn bộ preflight; nếu dưới 4,5 GiB thì dừng, không retry liên tục hoặc hạ gate. Raw logs/reports mới phải được lưu ngoài Git, có provenance và có thể chia sẻ hợp lệ với reviewer.
5. **Trước merge:** hoàn tất acceptance, Independent Code Review thật sự độc lập, xử lý defect có căn cứ và nhận quyết định Owner. Draft PR phục vụ cộng tác không phải phê duyệt merge.
