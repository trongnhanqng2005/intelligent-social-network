# ISN-B Spark ETL Scenario Acceptance

## Controlled recovery handoff

### Stable storage and Phase 3 continuation

The Owner approved `D:\DoAn\BigData\_isn-b-artifacts` as stable storage. The 58 Parquet copies are now at `D:\DoAn\BigData\_isn-b-artifacts\preserved-parquet-9bf585778f0443e8bce23d83e61c0d22`; their inventory is `D:\DoAn\BigData\_isn-b-artifacts\preservation-inventory-f83e725c2fde4c6e8ea885fc82740102.json` (SHA-256 `a67a9a1c6f1de8c2b00056192dab449ed7305b9c6f545bb5d044f22e282d298b`). All 58 copies matched their recorded byte sizes and hashes before the two explicitly authorized temporary copies were deleted. The inventory's paths refer to the original scenario outputs; relative paths map into the stable copy root. The original output files were not deleted. Stable storage is on the same drive, not an independent off-drive backup.

Six inputs (`lf`, `crlf`, `no_final_lf`, `single_edge`, `empty`, `resource`) were regenerated from the checked-in fixture/specification and checked against the frozen byte sizes and SHA-256 pins. They and their recovery report are at `D:\DoAn\BigData\_isn-b-artifacts\recovery-inputs-dde599c069674d7e96fe75d6f3e39d72`. The `gzip` and `malformed_only` source bytes have not been recovered to their frozen pins. The driver therefore cannot yet use this directory as a complete variant root.

The new `D:\DoAn\BigData\_isn-b-artifacts\recovery-baseline-e53d3ad77b9a4b3db245b6ac40502d2b.json` is explicitly a **new preflight preservation snapshot**, not the missing historical baseline. Its 116 records cover the 58 original Parquet files and their stable copies, each checked against the earlier inventory; five source fixture files and the previously pinned image identity are also recorded. A separate PowerShell verification rechecked all 121 files and the local Docker image identity. This is preservation evidence only: row expectations remain the independent checked-in synthetic specification, not the output bytes. The missing original historical evidence remains missing. Before full-driver use, recover both missing pinned inputs, and use the driver's explicit `-ArtifactBase`, `-VariantFixtureRoot` and `-HistoricalBaseline` parameters to select stable storage and the clearly labeled recovery snapshot; no historical evidence is implied by the parameter name.

A continuation sample measured 4,441,595,904 bytes (4.137 GiB), below the 4.5-GiB gate. No Doctor or Spark ran during this continuation; actual publication rows, cross-run determinism and full-driver acceptance remain unverified. A sample is not a future launch authorization; all existing preflight and immediate-launch checks remain mandatory.

The Owner authorized controlled recovery, including new publications in separate paths, without lowering the 4.5-GiB gate. The historical results below are retained as a contemporaneous summary, not as currently revalidated raw evidence. The scenario root's reports, logs, fixtures and baseline are empty; its seven former publication paths each retain eight Parquet files but no completion marker or run manifest. The harness-fix reports are also empty. A bounded search of related `isn-b-etl-*` roots and the named evidence-backup root did not find the historical verifier report, c008 report, completion markers or failure report. The cause of their absence is unknown.

The original recovery created an inventory and separate temporary copies of all 58 remaining Parquet files, including two in the incomplete malformed-only case; the later stable-storage continuation above supersedes those temporary paths. The inventory establishes current bytes, not original provenance or row correctness. No old output was overwritten or given a reconstructed marker. The driver generates a GUID-unique root and contains no artifact-root removal; the pipeline documents no automatic output cleanup. Neither observation establishes why historical files disappeared or guarantees protection from external cleanup.

The verifier's empty-table logical hash was corrected to hash zero bytes, consistent with the producer's existing per-row LF contract. A focused regression failed before the fix and passed afterward; the verifier schema/digest suite passed 7/7 and the local pipeline unit suite passed 26/26 without starting Spark. Resource-gate tests passed 3 memory and 4 process-classifier cases; Docker-monitoring tests passed 28 assertions. These checks do not constitute Parquet acceptance.

Full-driver recovery is not ready: the required historical baseline `D:\temp\opencode\isn-b-etl-acceptance-20261014-01\baseline\before.json` is missing, and all eight frozen variant directories contain no files. The existing driver requires that baseline for image identity and historical preservation checks and requires the exact pinned variants. Do not relabel a new snapshot as historical or silently weaken those checks; establish a truthful recovery baseline and reproduce or recover the exact pinned inputs before a new driver attempt. A later host-memory sample was 4,698,968,064 bytes (4.376 GiB), below the required 4,831,838,208 bytes. No Doctor or Spark was started in this recovery pass. Synthetic acceptance, independent review and Git publication remain incomplete.

## Scope and gates

This record covers the Owner-approved synthetic Step 5 acceptance only. It uses the Windows PowerShell launcher, pinned Docker Linux runtime, local PySpark, and an independent Spark verifier for all eight outputs. SNAP acquisition/processing remains **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION**. No Neo4j database access, application service, or other worktree is in scope.

The driver is `tests/integration/data_pipeline/acceptance.ps1`. It creates a GUID-unique artifact root under `D:\temp\opencode`, preserves publications, records sanitized child logs/container/resource evidence, requires at least 4.5 GiB free host RAM immediately before each Spark launch, and runs workloads serially. Reuse is explicit via `-DoctorEvidencePath <path>` and fail-closed. A fresh Doctor must pass the bounded post-Doctor RAM gate and strict evidence validation before the remaining suite can start.

## Frozen F1 source bytes

`acceptance-edges.txt` is UTF-8 without BOM, has 24 logical lines, a literal U+0009 tab in line 8, LF endings, and one final LF. SHA-256 is `ba12a5109386626da09c0ea1edd06e73b8b3b2c2046c32fbce9591d55e0e80ad` (252 bytes). Frozen variants: CRLF `685a1dd9e4b8a8872e317e2236ec814b3653308e9849249753cb45b339d46b30` (276 bytes); no-final-LF `e33f8bf68ebf58ce29887f13ba91ac2ccf4c80a5a080b5709fd1353e587358be` (251 bytes); gzip `dfd2e2cb0388406722f8f2e00bcb736a0a858f7cc5cf6c3abb354d507fa22916` (163 bytes), decoding to the LF fixture hash/size. Host SHA-256, decoded bytes, UTF-8, line endings and logical records are checked against independently frozen expectations before acceptance workloads.

Expected rows, reason precedence, all 11 quality metrics, schemas, and independently derived source/run/record identity fingerprints are frozen in `tests/fixtures/data_pipeline/acceptance-edges.expected.json`; Spark outputs are not used to derive those expectations.

## Prior reuse attempt

The earlier explicit reuse attempt at `D:\temp\opencode\isn-b-etl-scenario-20261015T020804Z-c00dfe8825e74c1ca1f6749c87408d2c` rejected the historical Doctor evidence at `D:\temp\opencode\isn-b-etl-scenario-20261014T192554Z-1ac07e62bafe4034a61ea1c735eace87\reports\failure.json`. It stopped with zero child commands and no Doctor/Spark/test/verifier fallback. Historical evidence could not establish the Docker context/configuration, daemon/client versions, Docker CLI hash, orchestrator/launcher PowerShell versions and executable hashes, runtime-source hashes, linked log hashes, or cidfile/removal state. The old artifacts were not edited. The detailed rejection is at `D:\temp\opencode\isn-b-etl-scenario-20261015T020804Z-c00dfe8825e74c1ca1f6749c87408d2c\reports\doctor-evidence-validation-final.json`.

## Consolidated 2026-10-15 authorized attempt

### Preflight and fresh Doctor

- Worktree/branch/HEAD were `D:\DoAn\BigData\isn-worktrees\data-ingestion-spark-etl`, `feature/data-ingestion-spark-etl`, `24181d9d9af24506fe2194fe7b4eef566e166d98`; no staged changes or Git mutations were made.
- Final read-only preflight at `02:39:45Z`: 6,261,403,648 bytes (5.831 GiB) free, above 4.5 GiB. Docker context `desktop-linux`, daemon `b45cce23-9633-4ec2-a4c3-511883a82a82`, client/server 29.8.2, 24 CPUs and 8,176,451,584 bytes memory. Pinned image was `sha256:e49006c31a9dc9681adbce6fb4ac77de042c19911a4548cf23cf071249c871cc` (Linux/amd64, user `10001:10001`); no active Docker containers or competing ISN-C/Spark-acceptance processes were found. Approved container settings stayed 2 CPUs, 4 GiB, 256 PIDs, network `none`.
- An earlier read-only process scan matched four Neo4j Desktop PowerShell/Java processes because the conflict filter treated any `neo4j` command line as an acceptance conflict. No database connection was made and no process was stopped or changed. The filter was narrowed to actual ISN-C/acceptance/Spark work, with four classifier regressions; the final preflight then found no conflicting process. The live RAM gate continued to account for all running host processes.
- Exactly one fresh Doctor invocation ran: invocation `1955c011c6ba4984ba04ebf64effeb4d`, `02:40:01.160Z`–`02:40:13.613Z`, exit 0, required `DOCKER_SPARK_PARQUET_SMOKE=PASS` marker. Its Spark smoke verified the pinned runtime, Python worker and Snappy Parquet path; this was **not** an ETL acceptance pipeline job.
- Evidence root: `D:\temp\opencode\isn-b-etl-scenario-20261015T023958Z-1955c011c6ba4984ba04ebf64effeb4d`. Fresh report: `reports\doctor-evidence.json`; run failure/recovery report: `reports\failure.json`; preflight: `baseline\before.json`; logs: `logs\001-doctor.stdout.txt` and `logs\001-doctor.stderr.txt`. Recorded stdout SHA-256 `1e6cb4741054b7e306254eb1e98cadaa467c98bf3d189c8e079d805d05ce07fd`; stderr SHA-256 `9956f347ae7e29cf523d9cca755c7b302fc5fedf64cd8684302020ff5d9ad369`.
- The evidence captured Docker context/configuration hash, daemon/client identity, CLI and PowerShell executable hashes, runtime/source fingerprints, pinned image, required versions and limits, Doctor exit/timestamps, container ID `7e5ebea05b3fc2d2bb70049f5778113a6e95a2e3fcd0bbb0fc9ba84174dc60ed`, cidfile match and `--rm` removal. The container used the required read-only workspace mount.
- **Evidence reuse is NOT VALIDATED and this report is not eligible for reuse as written.** Reviewing the preserved JSON found `container.labels.invocation_id` and `command_id` serialized as empty objects. The strict reuse validator was not run because the post-Doctor RAM gate failed first. The run's `failure.json` contains a preliminary `doctor_validation.eligible=true` placeholder; that field is not a strict validation result. The evidence file has not been rewritten or upgraded. A post-run regression fix now extracts dotted Docker label keys correctly and reports deferred strict validation explicitly; focused tests pass, but the fix has not been exercised by another Doctor. Do not claim this Doctor evidence is reusable.

### Post-Doctor resource gate and stop

The driver recorded the Doctor launch gate at 6,161,121,280 bytes (5.738 GiB). Bounded passive recovery sampled:

| UTC | Free bytes | GiB |
|---|---:|---:|
| 02:40:13 | 3,223,199,744 | 3.002 |
| 02:40:29 | 3,393,249,280 | 3.160 |
| 02:40:44 | 3,442,184,192 | 3.206 |
| 02:40:59 | 3,520,913,408 | 3.279 |
| 02:41:14 | 3,712,978,944 | 3.458 |

After 60 seconds, free RAM remained below the mandatory 4.5-GiB threshold (4,831,838,208 bytes). The driver stopped safely. No unit/integration container, ETL Spark job, CLI matrix, independent verifier, or publication started. No second Doctor or other container was started.

### Docker monitoring

During Doctor, monitoring captured valid samples (`57.67MiB / 4GiB|2` and `209.8MiB / 4GiB|40`). At teardown, `docker stats` exited 1 with `EOF`; a follow-up confirmed the container was missing after `--rm`, so it was classified `BENIGN_TEARDOWN_RACE`, not a transport failure or Spark failure. Doctor itself exited 0. Run disposition: `PASS_WITH_BENIGN_TEARDOWN_RACE`. The classifier/disposition regressions passed 10 assertions. No separate live fault injection or ETL-run monitor observation occurred.

## Scenario results

| Scenario | Result | Evidence / remaining work |
|---|---|---|
| ETL-00 Runtime/evidence readiness | **PARTIAL — BLOCKED BY HOST CAPACITY; evidence reuse not validated** | One Doctor smoke passed. Bounded RAM recovery failed; strict reuse validation did not run. Captured label values are incomplete in the immutable run evidence. |
| ETL-01 Source integrity/provenance | **PARTIAL PASS** | B1 host-side frozen fixture bytes, hashes, decoded content, UTF-8, line endings and logical records passed before Doctor. `prepare-source` CLI cases did not run. |
| ETL-02 Bronze ingestion | **NOT EXECUTED** | No ETL Spark job. |
| ETL-03 Silver, transformations and quarantine | **NOT EXECUTED** | No ETL Spark job. |
| ETL-04 Gold outputs | **NOT EXECUTED** | No ETL Spark job. |
| ETL-05 Determinism/cross-publication comparison | **NOT EXECUTED in this attempt** | No acceptance publication or independent comparison. Historical identity-pin checks remain partial evidence only. |
| ETL-06 Publication, reuse and failure recovery | **NOT EXECUTED in this attempt** | B2/B3 focused regressions passed in the earlier 7/7 integration run, not rerun here; complete acceptance publication/recovery matrix remains pending. |
| ETL-07 CLI matrix/error handling | **NOT EXECUTED** | One successful `doctor` CLI invocation only; no negative-path matrix. |
| ETL-08 End-to-end/resource stability | **BLOCKED BY HOST CAPACITY** | No further acceptance container started after post-Doctor recovery remained below 4.5 GiB. Two-Spark concurrency remains blocked by Docker memory capacity. |
| ETL-09 Real SNAP source | **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION** | No download or processing. |
| ETL-10 Cleanup/final integrity | **NOT EXECUTED** | Doctor `--rm` teardown was confirmed; final protected-artifact/worktree inventory and publication recheck did not run. No ETL publication was created. |

All eight ETL Parquet tables were **NOT EXECUTED / NOT VERIFIED** in this attempt: Bronze `raw_records`, Bronze `metadata`, Silver `nodes`, `edges`, `quarantine`, `quality_metrics`, Gold `nodes`, and Gold `edges`. No schema/content, manifest/checksum/completion-marker, deterministic rerun/reuse, or cross-publication check was performed.

### B1/B2/B3, tests and concurrency

- **B1:** host-side fixture pin/content/logical-record verification passed in this attempt. Launcher `prepare-source` cases remain unrun.
- **B2:** independent publication-process race (exactly one safe winner) passed historically in the 7/7 integration run; not rerun in this attempt.
- **B3:** unexpected in-table and out-of-table Parquet inventory rejection preserving the completion marker passed historically in the 7/7 integration run; not rerun in this attempt.
- This attempt ran one Docker Doctor command only. Acceptance unit tests: **0 current** (historical 26/26 passed). Acceptance integration tests: **0 current** (historical 7/7 passed). CLI negative-path cases: **0**. ETL pipeline jobs: **0**. Independent verifier: **0**. Prior results are not substitutes for outstanding acceptance coverage.
- Focused offline PowerShell regressions after the evidence-capture correction: Doctor evidence **33 assertions PASS**; monitoring **10 assertions PASS**; host-memory recovery **3 cases PASS**; process classifier **4 cases PASS**. All seven touched PowerShell scripts parsed; `git diff --check` passed.
- Two concurrent Spark containers were not attempted. Docker memory is 8,176,451,584 bytes, below the two-container combined limits of 8,589,934,592 bytes. **Two-Spark concurrency remains BLOCKED BY RESOURCE CAPACITY.**

## Status of the earlier 02:40 attempt (historical)

- **Synthetic Step 5 acceptance: BLOCKED / INCOMPLETE.** The strict host gate stopped the run after one successful Doctor; required ETL scenarios and verifier did not start. Fresh evidence is preserved but is not yet strict-reuse validated and has empty captured Docker label fields.
- **Real SNAP acceptance: BLOCKED BY SOURCE AUTHORIZATION.** Rights evidence, trusted source pins and separate Owner approval remain required.
- **Evidence paths:** `D:\temp\opencode\isn-b-etl-scenario-20261015T023958Z-1955c011c6ba4984ba04ebf64effeb4d\reports\doctor-evidence.json`, `...\reports\failure.json`, `...\baseline\before.json`, and `...\logs\001-doctor.{stdout,stderr}.txt`. Earlier rejected reuse and historical Doctor artifacts remain untouched under their previously recorded roots.
- **Code changes for verified defects:** source fingerprints now exclude changing harness/reports while covering runtime inputs; process conflict classification now targets ISN-C/acceptance/Spark rather than unrelated Neo4j service processes; Docker label extraction handles dotted keys; pre-postflight status now says strict reuse validation is not run yet. Focused regressions listed above pass. The corrected label capture still needs a separately authorized fresh Doctor before any later reuse attempt.
- Branch/HEAD remain `feature/data-ingestion-spark-etl` / `24181d9d9af24506fe2194fe7b4eef566e166d98`; changes remain unstaged and uncommitted. No commit, push, merge, Step 6 review or Step 7 publication occurred. No Neo4j database access or process interruption, ISN-C changes, or other-worktree access occurred.
- This was the state before a later Owner-authorized continuation, recorded below.

## Latest authorized continuation — 2026-10-15 04:30Z

### Fresh Doctor and scenario execution

- Invocation `530a7687b6ef49918edba24b080fb497`; evidence root `D:\temp\opencode\isn-b-etl-scenario-20261015T043051Z-530a7687b6ef49918edba24b080fb497`. The fresh Doctor exited 0, emitted the required smoke PASS marker, and its strict evidence validator immediately returned `eligible=true` / `VALIDATED`. Its post-Doctor live RAM gate passed at 5,124,583,424 bytes (4.773 GiB); ETL-00 recorded `PASS_FRESH_AND_REUSED_DOCKER_DOCTOR`. Evidence and logs are retained and have not been edited.
- Pinned image, Docker context/daemon and approved 2-CPU/4-GiB/256-PID/network-none limits matched preflight. The 4.5-GiB per-launch gate passed for every driver Spark launch; the minimum recorded was 4,906,209,280 bytes (4.569 GiB). Jobs were serial; two-Spark concurrency was not attempted.
- The driver ran 26 unit tests and 8 integration tests successfully. All six source-preparation cases passed. Seven synthetic publications were produced across LF, CRLF, no-final-LF, gzip, single-edge and resource inputs, including primary/reuse and independent LF runs. Their run commands exited 0; the ten expected negative CLI commands all exited 2.
- After the final negative CLI command, the driver stopped with `FAILED`: it required the exact diagnostic `Docker daemon is unavailable`, while PowerShell 5.1 surfaced Docker 29.8's connection error (`failed to connect to the docker API ... The system cannot find the file specified.`). The command still exited 2, no container was created for that unavailable endpoint, and the failure is a diagnostic assertion mismatch—not a successful driver completion. Preserved report: `reports\failure.json`; command logs: `logs\027-docker-endpoint-diagnostic.{stdout,stderr}.txt`. The acceptance driver did not reach its final verifier/reporting phase.

### Publication integrity and verifier defect

- A read-only audit after the driver checked all seven publication markers against the exact run-manifest bytes and source identity. The expected eight-table set was present in every run. All 56 registered Parquet files matched manifest byte sizes/SHA-256s, and each run had an exact registered-vs-physical Parquet inventory. This does **not** verify Parquet footers, rows, schemas or logical equivalence.
- The first independent verifier launch (`c028`) exited 1 at `silver/nodes.dataset_id`: footer metadata had `nullable=true`, while the verifier demanded the declared schema's `nullable=false`. The producer and `docs/big-data/parquet-contracts.md` intentionally distinguish declared schema from Spark's normalized footer/read nullability; required null checks remain separate. Preserved failure details are in `reports\independent-verifier-attempt-1.json` and logs `028-independent-verifier.{stdout,stderr}.txt`.
- Corrected the independent verifier to ignore only the footer nullability bit while retaining declared-manifest nullability checks, Spark read-schema checks, exact field order/types/metadata, and row/null validation. Added `test_acceptance_verifier_schema.py`; its focused Docker regression passed 3/3 (the RED run is `c029`, GREEN run `c030`, with both containers removed and inventory unchanged).
- A second verifier launch (`c031`) was attempted under a fresh passing RAM gate. Its standalone PowerShell monitor treated `docker inspect`'s expected post-`--rm` “no such object” race as terminating before it persisted stdout/stderr or the child exit code. The container and client process are gone, but the verifier result is **UNKNOWN** and no PASS is claimed. Do not retry it in this continuation. Record: `reports\independent-verifier-attempt-2.json`; cidfile: `container-ids\c031.cid`.

### Final integrity and acceptance status

- Read-only preservation checks matched all 68 historical publication files and both protected source files (70/70), plus all five frozen fixture inputs. The seven new runs' 56 registered files matched their manifests. Container IDs and volume inventory matched the preflight inventory; no container remains running. Branch/HEAD remain `feature/data-ingestion-spark-etl` / `24181d9d9af24506fe2194fe7b4eef566e166d98`. The only worktree-status delta since this invocation's preflight is the newly added verifier regression test.
- **Synthetic ETL-00–ETL-10 acceptance remains INCOMPLETE.** Runtime/evidence readiness, unit/integration tests, preparation, ETL command exits, expected failure exits, publication markers and physical-file integrity passed. The full independent Spark verification did not produce captured evidence, and the acceptance driver ended on its endpoint-diagnostic assertion. The verifier fix has only focused regression evidence; full verifier completion, final driver PASS and its generated `acceptance-evidence.json` remain outstanding.
- SNAP remains **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION**. No Neo4j access, unrelated-process interruption, other-worktree access, commit, push, Step 6 Independent Code Review or Step 7 Git Publication occurred. This was the prior handoff state; the follow-up continuation below records subsequent authorized harness/verifier work.

## Follow-up continuation — 2026-10-15 05:52–06:32Z

### Harness and verifier fixes

- Fixed Docker-unavailable diagnostic matching for the observed Docker 29.8 named-pipe error and hardened fail-closed monitor/verifier result handling. The actual invalid-endpoint launcher path exited 2 with its expected diagnostic. `test_acceptance_docker_monitoring.ps1` passed 28 assertions; the three acceptance PowerShell files parsed, Python AST parsing passed for the verifier and schema tests, and `git diff --check` passed.
- c002 exposed a verifier hostname-resolution failure under `--network none`; the verifier launch now maps its own hostname to loopback. A constrained network-none smoke test resolved the hostname to `127.0.0.1`.
- Fixed manifest schema-hash verification to hash the declared schema rather than Spark's footer schema, whose nullability is normalized. Added explicit per-table nullable read schemas to avoid repeated Spark Parquet schema inference. The focused verifier schema suite passed 5/5, including the declared-schema hash and explicit read-schema regressions.

### Independent verifier attempts and remaining failure

- c002 (invocation `de0e13c579c34349a57bca5819efd0a6`) exited 1 because the verifier hostname could not be resolved. Captured stdout/stderr and exit evidence are under `D:\temp\opencode\isn-b-etl-harness-fixes-20261015T053133Z-72a33f213910464c9048fb3ecc2a5738\logs\independent-verifier-retry.*` and `reports\independent-verifier-retry-execution.json`.
- c003 (invocation `b15c21e9ac9642189c81e0c1ea2d63ce`) exceeded the 15-minute wrapper timeout while Spark's Parquet-footer worker could not create a native thread and the driver heartbeat was lost. Its uniquely labeled container was captured, then stopped and removed; the child verifier outcome remains **UNKNOWN**, not PASS. Runtime/log evidence is in `reports\independent-verifier-c003-stuck-container.json` and `logs\c003-stuck-container\`.
- c004 (invocation `68e27cd051c14541ace74b29ad582943`) ran under the pinned image, 2-CPU/4-GiB/256-PID, network-none limits, read-only mounts, and a passing 6.461-GiB prelaunch host RAM gate. It exited 1 after 18 seconds at `silver/quarantine: manifest logical hash differs from independently serialized rows`. Captured evidence is in `reports\independent-verifier-c004-execution.json`, `reports\independent-verifier-c004-precleanup.json`, and `logs\independent-verifier-c004.{stdout,stderr}.txt`. No verifier report or Spark teardown PASS was emitted. The verifier-only result is **FAILED**, and the cause of the logical-hash disagreement remains unresolved; no further Spark launch was made.
- The c004 container was removed after capturing its logs and exit code. Its run report records the required runtime limits, read-only mounts, stats, Docker lifecycle and unchanged container/volume inventories. A subsequent read-only check found no running containers; host free RAM was 6.559 GiB at 06:32Z. The prior preservation audit remains 70/70 historical/protected files, 8/8 frozen synthetic inputs, and seven publications with 56 manifest-matching Parquet files and exact inventories. That audit did not prove footer, row or logical-hash correctness.

### Handoff at end of prior continuation (superseded below)

- **Synthetic ETL-00–ETL-10 acceptance remains INCOMPLETE.** The verifier has focused regression evidence but no successful independent verification; the fresh Doctor evidence is stale against the fingerprinted harness changes, and the full driver was not rerun. Do not infer PASS from physical-file integrity or the c004 resource/runtime checks.
- SNAP remains **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION**. No Neo4j access, unrelated-process interruption, ISN-C changes, or other-worktree access occurred. Changes remain unstaged and uncommitted on `feature/data-ingestion-spark-etl`; no Step 6 Independent Code Review or Step 7 Git Publication occurred. Stop this continuation here.

## Owner-authorized c004 resolution continuation — 2026-10-15 06:39–06:57Z

### c004 logical-hash investigation and three-way comparison

- c004 (`68e27cd051c14541ace74b29ad582943`) exited 1 at `silver/quarantine`'s manifest-vs-observed logical-hash assertion. Its verifier did not emit the computed digest, row payload, or a verifier report. Thus c004's actual observed digest and row-level difference cannot be reconstructed from that invocation; the preserved failure remains real historical evidence.
- Independently derived expected rows and hashes from the frozen CRLF fixture and approved transformations (without using Spark output or manifest values as expectation inputs). For the writer and verifier, the applicable contract is compact Spark JSON from `struct` fields in declared schema order with nulls retained, lexical sort of serialized rows, UTF-8, LF between and after rows, then SHA-256. The writer's manifest-hash algorithm is in `data-pipeline/src/isn_etl/pipeline.py`; the verifier uses the explicit nullable table schema and equivalent serialization in `tests/integration/data_pipeline/acceptance_verify.py`.
- A read-only Spark observer (c005, one case, read-only mounts, pinned image, 2 CPU/4 GiB/256 PID/network-none, launch RAM 4.646 GiB) read the exact immutable c004 publication. For all eight tables its actual row counts and logical hashes matched the manifest. Exact schema-ordered serialized row lists for the six independently fixture-derivable Silver/Gold tables also matched the fixture-derived rows, not merely their hashes.

| Table | Fixture-derived rows / SHA-256 | Actual Parquet rows / SHA-256 | Immutable manifest rows / SHA-256 | Comparison |
|---|---|---|---|---|
| `silver/nodes` | 8 / `c4b5b97d8186539e61884f4af537a8bdbfe6d932af2768638836c9b2ee218298` | 8 / same | 8 / same | Exact serialized rows match; PASS |
| `silver/edges` | 5 / `e981ae6008e63847dbc8baddac8053586adc5b690cde90257988d4e56db956a7` | 5 / same | 5 / same | Exact serialized rows match; PASS |
| `silver/quarantine` | 12 / `5e6c3d5c9eee72d6b3614639ef3ff88adc138a387e9cedbe3c18f773120ea42d` | 12 / same | 12 / same | Exact serialized rows match; PASS |
| `silver/quality_metrics` | 11 / `eec54a08206c9a0a9341a5a116efce294bc75e02362c76ca34b4e001841a9b5c` | 11 / same | 11 / same | Exact serialized rows match; PASS |
| `gold/nodes` | 8 / `488bb3fb1ff41612d680e6fda8a1768aca734121b9a89bb0571d9cda0dad4a40` | 8 / same | 8 / same | Exact serialized rows match; PASS |
| `gold/edges` | 5 / `4de5e7ad4ce302ac7240a3365e183b5574fbd459b5b62da4efcb5e2871348d7f` | 5 / same | 5 / same | Exact serialized rows match; PASS |

- Record-level checks: Silver nodes are `0, 1, 2, 10, 20, 21, 9223372036854775806, 9223372036854775807`; Silver edges are `(0,1,3)`, `(2,10,2)`, `(20,21,1)`, `(0,9223372036854775807,1)`, `(9223372036854775806,9223372036854775807,1)`. Quarantine contains lines 13–24 with the fixture-pinned reason codes; line 17 preserves U+0661 (`١`) exactly. Metrics account for 24 raw records, 2 blanks, 2 comments, 20 candidates, 12 quarantined, 8 valid edge occurrences, 5 unique edges, 3 duplicate excess, 8 nodes, and 5 Gold edges. No fixture/Parquet differences were found.
- The exact official independent verifier was then run on c004's CRLF case as c006. Child exit code **0**, report status **PASS**, exact eight-table set, all table counts/hashes, schema/provenance/metrics/inventory checks passed, and SparkContext/active-session teardown fields passed. Report: `D:\temp\opencode\isn-b-etl-harness-fixes-20261015T053133Z-72a33f213910464c9048fb3ecc2a5738\reports\c004-official-verifier-report.json`; captured stdout/stderr and their hashes are in the adjacent `logs\c004-official-verifier.*.txt` and `reports\c004-official-verifier-result.json`. The wrapper initially labelled its run incomplete because it queried Docker events after creation and before cleanup; the read-only supplemental event audit confirms `create → start → die(0) → destroy`, container removal, and unchanged Docker inventories: `reports\c004-official-verifier-lifecycle-audit.json`.
- **Root cause conclusion:** no ETL transformation, manifest, schema, canonicalization-contract, or verifier defect was established. The mismatch did not reproduce on unchanged publication bytes: c005's independently read Parquet hash and c006's exact official verifier both produce the manifest hash. The precise transient cause of c004 remains **unknown** because c004 did not capture its calculated digest/rows. No source change, historical evidence rewrite, or verification weakening was justified. The c004 data/hash blocker is cleared for this publication, but the historical failure is not erased or misreported as a proven transient mechanism.

### Remaining seven-case verifier and acceptance disposition

- c007 was prepared to run the official verifier serially across all seven immutable publications. It was blocked before container start when the immediate host free-RAM sample was 3,801,051,136 bytes (3.541 GiB), below the mandatory 4,831,838,208-byte (4.5 GiB) gate. The existing bounded 60-second passive recovery window remained below threshold (3.214–3.322 GiB); Docker events show only `create` and `destroy`, no `start`. The created container was removed and no container remains running. Evidence: `reports\c007-seven-case-verifier-blocked.json`. No further Spark launch was attempted.
- c004 has a successful exact official-verifier PASS, but the complete seven-case verifier suite and full acceptance driver did not run to completion. The previous driver had completed unit/integration tests, six source preparations, seven synthetic publication cases including reuse/independent LF, and ten negative CLI exit-code checks before its endpoint-diagnostic assertion stopped it. The fixed unavailable-endpoint path separately exited 2 with the expected diagnostic; focused Docker-monitoring tests passed 28 assertions and verifier-schema regressions passed 5/5. The previous fresh Doctor evidence is no longer eligible for strict reuse against the changed harness fingerprints. No new Doctor or full driver was run.
- The read-only final integrity audit still passes: seven publications, all eight table manifests, all 56 registered Parquet file sizes/hashes and exact physical inventories, and all eight frozen synthetic inputs match. The prior protected-artifact audit matched 70/70 historical/protected files. c005/c006 left the publication bytes unchanged; c006's lifecycle audit and final Docker inventory matched baseline.

### ETL-00–ETL-10 and B1/B2/B3 status

| Check | Latest status | Evidence / limitation |
|---|---|---|
| ETL-00 Runtime/evidence readiness | **PASS for the prior authorized run; not refreshed for a new full driver** | Fresh Doctor and strict reuse validation passed in invocation `530a7687b6ef49918edba24b080fb497`; evidence is now fingerprint-stale for reuse after subsequent harness changes. No unnecessary Doctor rerun was made. |
| ETL-01 Source integrity/provenance | **PASS** | Frozen input/identity pins 8/8; six source-preparation cases passed; c006 independently checked the CRLF source/provenance. |
| ETL-02 Bronze ingestion | **PASS for c004; seven-case independent coverage incomplete** | c005 read 24 raw rows and 1 metadata row with hashes matching the manifest; c006's official verifier passed those tables for c004. |
| ETL-03 Silver transformations/quarantine | **PASS for c004; seven-case independent coverage incomplete** | Fixture → exact serialized Parquet rows → manifest matched for all four Silver tables; c006 official verification passed c004. |
| ETL-04 Gold outputs | **PASS for c004; seven-case independent coverage incomplete** | Fixture → exact serialized Parquet rows → manifest matched for both Gold tables; c006 official verification passed c004. |
| ETL-05 Determinism/cross-publication comparison | **PARTIAL** | Primary/reuse snapshot was unchanged and an independent LF publication succeeded. The full verifier's planned comparison of primary vs independent LF logical rows was not reached; c007 was resource-blocked. |
| ETL-06 Publication, reuse and failure recovery | **PARTIAL PASS** | Seven immutable publications and primary reuse were exercised; B2's two-process publication race had exactly one safe winner; B3 reader-visible unexpected Parquet files blocked reuse without changing the manifest. A complete acceptance-driver recovery matrix/final report was not produced. |
| ETL-07 CLI matrix/error handling | **PASS for captured cases; full driver not rerun** | Ten negative CLI commands exited 2; the repaired unavailable-Docker-endpoint diagnostic separately exited 2 with the expected diagnostic. The fixed full matrix was not rerun end-to-end. |
| ETL-08 End-to-end/resource stability | **INCOMPLETE / RESOURCE-BLOCKED** | c004 single-case official verification passed. The seven-case verifier and final driver completion were not run; c007 was blocked by host RAM. Two concurrent Spark containers remain **BLOCKED BY RESOURCE CAPACITY** (Docker memory 8,176,451,584 bytes < combined 8,589,934,592-byte limits). |
| ETL-09 Real SNAP source | **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION** | No SNAP download or processing. |
| ETL-10 Cleanup/final integrity | **PASS for direct audits; driver-generated final sentinel absent** | 70/70 protected files, 8/8 frozen inputs, 56/56 Parquet hashes/exact inventories, c006 teardown, and unchanged Docker inventories passed. No full acceptance `acceptance-evidence.json` was emitted. |

- **B1 provenance/identity: PASS** (frozen source and record identity pins); **B2 isolation: PASS** for publication-process race, with simultaneous Spark execution blocked by capacity; **B3 publication inventory: PASS** (Spark-visible rogue/inventory regression).
- **Synthetic Acceptance: INCOMPLETE, not PASS.** The c004 logical-hash failure is not reproducible and c004's official verifier now passes, but the all-seven verifier/full driver completion is still missing due to the RAM gate and stale strict-Doctor reuse evidence. This is a resource/evidence limitation, not a remaining data-contract decision.
- **SNAP: BLOCKED BY SOURCE AUTHORIZATION.** **Two-Spark concurrency: BLOCKED BY RESOURCE CAPACITY.** No Neo4j access, other-worktree action, unrelated-process interruption, Step 6 Independent Code Review, or Step 7 Git Publication occurred. Branch/HEAD remain `feature/data-ingestion-spark-etl` / `24181d9d9af24506fe2194fe7b4eef566e166d98`; changes remain unstaged/uncommitted and the index remains empty.

## Final Owner-authorized synthetic acceptance report — 2026-10-15 07:05–07:11Z

This section supersedes the c007 handoff disposition above. It records the final authorized continuation; prior evidence remains historical and unchanged.

### Seven immutable publications and eight-table verification

The seven existing publication paths were reused without modification. c006 is the one complete official independent-verifier PASS. The six-case c008 verifier did **not** start: its immediate pre-start host-memory sample was 3,225,231,360 bytes (3.004 GiB), below the required 4,831,838,208 bytes (4.5 GiB). Earlier preflight samples were 5.128 GiB at 07:05:57Z and 5.211 GiB during runner preparation; neither overrides the immediate fail-closed gate. c008's Docker events were `create → destroy` with no `start`; the container was removed, verifier exit is **N/A** (not zero), and no retry was made.

| Immutable publication | Run ID | Official independent verifier | Eight-table actual Parquet status |
|---|---|---|---|
| `f1_crlf` | `1834ed01333afcb99e8bfdde55024a17f6b8347cabe6e9fd7d4ce09aefa015be` | c006: **PASS, child exit 0** | All eight tables independently read and passed |
| `f1_no_final_lf` | `ce136778aba4cb9849339ab85f809db410d6815370e20e007ae8f030e81e5a0b` | c008: **NOT STARTED** | All eight remain independently unverified |
| `f1_gzip` | `d26c208462e0434e78a6ebc55052227d36253f66388dd74c3ab5e9e0181666dd` | c008: **NOT STARTED** | All eight remain independently unverified |
| `single_edge` | `22e3c5eb7fa92fbb6ca400126aa65daf447ae441c9f04cd990c08ed631852f96` | c008: **NOT STARTED** | All eight remain independently unverified |
| `resource` | `a47162fc52cef06ce70f3ac7cd972efc957398960fc47739af7a5f48f40353ac` | c008: **NOT STARTED** | All eight remain independently unverified |
| `f1_lf` | `61fc2a3848771dd69ed532960d0739bb1156ed54f19ca461ed9b63cc6ccbfad2` | c008: **NOT STARTED** | All eight remain independently unverified |
| `f1_lf_independent` (separate output path) | `61fc2a3848771dd69ed532960d0739bb1156ed54f19ca461ed9b63cc6ccbfad2` | c008: **NOT STARTED** | All eight remain independently unverified |

The eight tables are `bronze/raw_edges`, `bronze/source_metadata`, `silver/nodes`, `silver/edges`, `silver/quarantine`, `silver/quality_metrics`, `gold/nodes`, and `gold/edges`. For c006, child exit 0 and report status `PASS` cover all eight tables' schemas/types, required-value/null checks, row counts and logical hashes, fixture/provenance/metrics, reader-visible inventory, and teardown. Per-table counts were raw 24, metadata 1, Silver nodes 8, edges 5, quarantine 12, quality metrics 11, Gold nodes 8, edges 5. The exact report is `D:\temp\opencode\isn-b-etl-harness-fixes-20261015T053133Z-72a33f213910464c9048fb3ecc2a5738\reports\c004-official-verifier-report.json`; child exit/report details are in `reports\c004-official-verifier-result.json`, and the supplemental `reports\c004-official-verifier-lifecycle-audit.json` confirms `create → start → die(0) → destroy`, removal and unchanged inventories. This c006 PASS supersedes c004's preserved verifier exit 1; c004 emitted no computed digest/rows, so its original cause remains unknown and no speculative code or evidence change was made. c005 separately read all eight c004 tables and matched actual Parquet row counts/logical hashes to the manifest; exact fixture-derived serialized rows also matched all four Silver and two Gold tables (`reports\c004-resolution-and-three-way-comparison.json`).

For the six c008-blocked publications, the host-side read-only audit checked source identity, completion-marker-to-manifest bytes, eight manifest table names/declarations, recorded schema/hash metadata, 56 registered Parquet file sizes/SHA-256s and exact physical inventory. It did **not** read Parquet footers or rows and is not a substitute for their independent verifier cases. c008 evidence: `D:\temp\opencode\isn-b-etl-harness-fixes-20261015T053133Z-72a33f213910464c9048fb3ecc2a5738\reports\c008-six-remaining-verifier-blocked.json` and `reports\c008-postattempt-integrity-and-determinism.json`. The preflight found no active acceptance container or competing Spark/ISN-C workload; container and volume inventories were unchanged after the attempt.

### Determinism, publication/recovery, and CLI

- Read-only manifest comparison found equal declared logical hashes for all six Silver/Gold tables across the separate `f1_lf` and `f1_lf_independent` output paths; source identity and metrics also matched. The two use the same content-derived run ID. This is **manifest-level determinism evidence only** for these six tables, not independent actual-row comparison. LF and gzip have identical uncompressed source bytes and matching manifest metrics, likewise not a Parquet-row comparison. c006/c005 provide the actual-row evidence only for `f1_crlf`.
- The prior full driver captured this complete 27-command matrix (exit 0 means command success; exit 2 was the expected negative-path code):

  | Command | Exit | Result / stable error category |
  |---|---:|---|
  | `doctor` | 0 | Runtime/Doctor success |
  | `test-unit` | 0 | 26/26 tests passed |
  | `test-integration` | 0 | 8/8 tests passed |
  | `prepare-lf` | 0 | Source preparation succeeded |
  | `prepare-crlf` | 0 | Source preparation succeeded |
  | `prepare-no_final_lf` | 0 | Source preparation succeeded |
  | `prepare-gzip` | 0 | Source preparation succeeded |
  | `prepare-resource` | 0 | Source preparation succeeded |
  | `prepare-single_edge` | 0 | Source preparation succeeded |
  | `run-f1_crlf` | 0 | Publication succeeded |
  | `run-f1_no_final_lf` | 0 | Publication succeeded |
  | `run-f1_gzip` | 0 | Publication succeeded |
  | `run-single_edge` | 0 | Publication succeeded |
  | `run-resource` | 0 | Publication succeeded |
  | `run-f1-lf-primary` | 0 | Primary LF publication succeeded |
  | `reuse-f1-lf-primary` | 0 | Existing LF publication reused |
  | `run-f1-lf-independent` | 0 | Separate-path LF publication succeeded |
  | `reject-metadata-conflict` | 2 | Completed-run source/config identity conflict |
  | `reject-no-valid-edges` | 2 | Source has no valid graph edges |
  | `reject-empty-source` | 2 | Empty source |
  | `reject-invalid-manifest-json` | 2 | Manifest JSON parse failure |
  | `reject-source-checksum-mismatch` | 2 | Frozen source SHA-256 mismatch |
  | `reject-invalid-utf8` | 2 | Invalid UTF-8 source |
  | `reject-unapproved-source` | 2 | Rights status unresolved / source use not approved |
  | `reject-missing-source` | 2 | Source file missing |
  | `reject-run-missing-arguments` | 2 | Required `-Source` / `-Manifest` arguments absent |
  | `docker-endpoint-diagnostic` | 2 | Docker endpoint unavailable; child code was expected, but the original driver's obsolete diagnostic-text assertion failed |

  Individual captured stdout/stderr logs are under `D:\temp\opencode\isn-b-etl-scenario-20261015T043051Z-530a7687b6ef49918edba24b080fb497\logs`, with aggregate child outcomes in `reports\failure.json`. The corrected unavailable-endpoint path separately exited 2 with the expected Docker named-pipe diagnostic and no container launch (`reports\harness-fix-regressions.json`; logs `logs\docker-endpoint-negative-path.{stdout,stderr}.txt`).
- The old full-driver endpoint assertion expected the former generic text, so the driver ended **FAILED** at that diagnostic assertion even though its child exited 2. The corrected unavailable-endpoint path was separately verified to exit 2 with the expected Docker named-pipe diagnostic and no container launch (`reports\harness-fix-regressions.json`; logs `logs\docker-endpoint-negative-path.{stdout,stderr}.txt`). The full driver was not rerun; no generated final `acceptance-evidence.json` exists.
- Reuse and recovery evidence: primary LF publication was successfully reused; separate LF publication completed; unit/integration coverage exercised marker-last publication, incomplete/malformed destination rejection and preservation; B2's independent publication-process race had exactly one safe winner; B3 rogue in-table and out-of-table Parquet inventory cases rejected reuse without changing the completion manifest. These do not complete the broader acceptance driver's final recovery/report matrix.

### Final ETL-00–ETL-10 disposition

| Criterion | Final status | Evidence and remaining gap |
|---|---|---|
| ETL-00 Runtime/evidence readiness | **PARTIAL — not current for another full driver** | Invocation `530a7687b6ef49918edba24b080fb497` passed fresh Doctor and strict reuse validation earlier. Later harness fingerprints changed, so that evidence is stale; no extra Doctor was run. c008 enforced the immediate RAM gate. |
| ETL-01 Source integrity/provenance | **PASS for synthetic fixture/source checks** | B1 pins and logical fixture checks passed; 8/8 frozen input files and source-to-publication manifest identities matched; six source-preparation commands passed; c006 verified CRLF provenance. |
| ETL-02 Bronze ingestion | **PASS for CRLF; seven-case coverage incomplete** | c005/c006 read and verified c004 Bronze raw (24) and metadata (1); other six publications await official verification. |
| ETL-03 Silver transformations/quarantine | **PASS for CRLF; seven-case coverage incomplete** | c005 fixture → actual Parquet → manifest rows matched all four Silver tables; c006 verified them. |
| ETL-04 Gold outputs | **PASS for CRLF; seven-case coverage incomplete** | c005 fixture → actual Parquet → manifest rows matched both Gold tables; c006 verified them. |
| ETL-05 Determinism/cross-publication | **PARTIAL** | Six LF Silver/Gold declared hashes and LF/gzip manifest metrics match. Independent actual-row cross-publication comparison for the remaining runs did not execute. |
| ETL-06 Publication, reuse, and failure recovery | **PARTIAL PASS** | LF reuse, independent publication, marker/incomplete-target unit/integration cases, B2 race and B3 inventory rejection passed. Final full-driver recovery matrix/report remains absent. |
| ETL-07 CLI/error handling | **PARTIAL PASS** | All 27 captured child exit codes are recorded (17×0, 10×2) with expected negative categories; corrected endpoint case separately passes. The driver itself failed at its stale endpoint-text assertion and was not rerun. |
| ETL-08 End-to-end/resource stability | **BLOCKED BY HOST CAPACITY** | c008 stopped before verifier start at 3.004 GiB < 4.5 GiB. Six publication verifier cases remain; full driver completion is outstanding. Two simultaneous Spark containers remain resource-blocked. |
| ETL-09 Real SNAP source | **NOT EXECUTED — BLOCKED BY SOURCE AUTHORIZATION** | No download, acquisition, or processing. |
| ETL-10 Cleanup/final integrity | **PARTIAL PASS** | Direct audit matched 70/70 protected files, 8/8 frozen inputs, all seven publication markers/manifests and 56/56 Parquet file hashes/exact inventories. c008 container was removed; inventories were unchanged. Driver-generated final acceptance sentinel is absent. |

### B1/B2/B3, tests, and final integrity

- **B1 PASS:** frozen source/record identity pins and synthetic provenance checks; 8/8 frozen inputs still match.
- **B2 PASS for publication-process concurrency:** exactly one safe reservation winner. Two simultaneous Spark containers were not started and remain **BLOCKED BY RESOURCE CAPACITY**; Docker memory is 8,176,451,584 bytes versus combined limits of 8,589,934,592 bytes.
- **B3 PASS:** reader-visible rogue Parquet inventory blocks reuse and leaves the completion manifest unchanged.
- Captured suite results: unit tests **26/26 PASS**, integration tests **8/8 PASS**; these are the earlier completed driver results, not rerun during c008. Focused verifier-schema regressions **5/5 PASS**, Docker-monitoring regressions **28 assertions PASS**, host-memory gate **3 cases PASS**, and process classifier **4 cases PASS**. The c008 attempt executed no verifier or tests. The corrected unavailable-endpoint negative path exited 2 as expected. No affected test was weakened and no c004 data/code change was made.
- Final immutable-artifact audit: **70/70** protected historical/source files and **8/8** frozen synthetic inputs match their recorded pins; **7/7** publications have all eight manifest tables, matching source identity and completion-marker bytes; **56/56** Parquet files match registered size/SHA-256 and each publication's physical inventory is exact. This integrity audit does not imply actual row/footer verification for the six blocked publications. No acceptance container remains running; container and volume inventories match baseline. No publication was regenerated or modified.

### Final disposition and scope

- `SYNTHETIC ACCEPTANCE: INCOMPLETE` — one of seven publications has a complete official verifier PASS; six remain unverified, and the full driver did not emit its final acceptance report.
- `FULL STEP 5: BLOCKED` — the immediate 4.5-GiB resource gate stopped c008 before Spark start; fresh strict-Doctor evidence would also be needed before a future full-driver run.
- `SNAP: BLOCKED BY SOURCE AUTHORIZATION`.
- `TWO-SPARK CONCURRENCY: BLOCKED BY RESOURCE CAPACITY`.
- Branch/HEAD remain `feature/data-ingestion-spark-etl` / `24181d9d9af24506fe2194fe7b4eef566e166d98`. Existing work remains unstaged/uncommitted; index empty. `git diff --check` passes. No Neo4j access, ISN-C or other-worktree access/action, unrelated-process interruption, system/Docker/WSL configuration change, commit, push, merge, PR, Step 6 Independent Code Review, or Step 7 Git Publication occurred. Stop here for Technical Adviser review; do not repeat the blocked Spark attempt without Owner authorization and a passing live RAM gate.
