from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any


class PublicationError(RuntimeError):
    """A run is incomplete, conflicting, or failed publication validation."""


_SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_RUN_ID = re.compile(r"^[0-9a-f]{64}$")


def create_staging_directory(output_root: Path, dataset_id: str, run_id: str) -> tuple[Path, Path]:
    if not _SAFE_NAME.fullmatch(dataset_id):
        raise PublicationError("dataset_id is not a safe output directory name")
    if not _RUN_ID.fullmatch(run_id):
        raise PublicationError("run_id must be a lowercase SHA-256 digest")

    root = output_root.resolve()
    final = root / dataset_id / "runs" / run_id
    staging_parent = root / ".staging" / dataset_id
    staging_parent.mkdir(parents=True, exist_ok=True)
    staging = staging_parent / f"{run_id}-{uuid.uuid4().hex}"
    staging.mkdir(mode=0o700)
    return staging, final


def write_run_manifest(staging: Path, manifest: dict[str, Any]) -> None:
    if not staging.is_dir():
        raise PublicationError(f"Staging directory does not exist: {staging}")
    payload = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8") + b"\n"
    try:
        with (staging / "_RUN_MANIFEST.json").open("xb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
    except FileExistsError as error:
        raise PublicationError("Run manifest already exists in staging") from error


def publish_staged_run(staging: Path, final: Path, run_id: str) -> Path:
    if not _RUN_ID.fullmatch(run_id):
        raise PublicationError("run_id must be a lowercase SHA-256 digest")
    if not staging.is_dir() or not (staging / "_RUN_MANIFEST.json").is_file():
        raise PublicationError("Validated staging directory and run manifest are required")
    if (staging / "_COMPLETE.json").exists():
        raise PublicationError("Completion marker must only be written after publication")
    if final.exists():
        raise PublicationError(f"Destination already exists; refusing overwrite: {final}")

    final.parent.mkdir(parents=True, exist_ok=True)
    try:
        final.mkdir()
    except FileExistsError as error:
        raise PublicationError(f"Destination already exists; refusing overwrite: {final}") from error

    for child in sorted(staging.iterdir(), key=lambda item: item.name):
        child.rename(final / child.name)

    manifest_bytes = (final / "_RUN_MANIFEST.json").read_bytes()
    run_manifest = json.loads(manifest_bytes)
    if run_manifest.get("run_id") != run_id:
        raise PublicationError("Run manifest identity does not match destination run_id")
    marker = {
        "completion_version": 1,
        "run_id": run_id,
        "run_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "status": "complete",
    }
    marker_bytes = json.dumps(marker, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    with (final / "_COMPLETE.json").open("xb") as complete:
        complete.write(marker_bytes)
        complete.flush()
        os.fsync(complete.fileno())

    staging.rmdir()
    return final


def read_completed_run(final: Path, expected_run_id: str) -> dict[str, Any]:
    if not final.is_dir():
        raise PublicationError(f"Completed run directory not found: {final}")
    marker_path = final / "_COMPLETE.json"
    manifest_path = final / "_RUN_MANIFEST.json"
    if not marker_path.is_file() or not manifest_path.is_file():
        raise PublicationError(f"Run is incomplete; completion marker or manifest is missing: {final}")

    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PublicationError(f"Cannot validate completed-run metadata: {error}") from error

    if not isinstance(marker, dict) or not isinstance(manifest, dict):
        raise PublicationError("Completed-run marker and manifest must be JSON objects")

    if marker.get("status") != "complete" or marker.get("completion_version") != 1:
        raise PublicationError("Completion marker has an unsupported or incomplete status")
    if marker.get("run_id") != expected_run_id:
        raise PublicationError("Completed run_id does not match the requested run_id")
    actual_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    if marker.get("run_manifest_sha256") != actual_sha256:
        raise PublicationError("Run manifest checksum mismatch")
    if manifest.get("run_id") != expected_run_id:
        raise PublicationError("Run manifest run_id does not match the requested run_id")
    return manifest
