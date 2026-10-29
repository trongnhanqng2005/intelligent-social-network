from __future__ import annotations

import gzip
import hashlib
import json
import re
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


class SourceValidationError(ValueError):
    """The source, manifest, rights status, or integrity check is invalid."""


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_DATASET_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class SourceManifest:
    manifest_version: int
    dataset_id: str
    source_file: str
    source_format: str
    graph_semantics: str
    source_sha256: str | None
    uncompressed_sha256: str | None
    source_bytes: int | None
    content_bytes: int | None
    acquired_at: str | None
    source_url: str | None
    citation: str
    rights_status: str
    rights_evidence: str | None
    schema_version: str
    transform_version: str
    quality_policy_version: str
    expected_reference_counts: dict[str, Any] | None


@dataclass(frozen=True)
class ValidatedSource:
    manifest: SourceManifest
    source_path: Path
    source_version: str
    source_sha256: str
    uncompressed_sha256: str
    source_bytes: int
    content_bytes: int
    records: tuple[tuple[int, str], ...]


def _optional_string(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SourceValidationError(f"{field} must be a string or null")
    return value


def load_manifest(path: Path) -> SourceManifest:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SourceValidationError(f"Manifest not found: {path}") from error
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SourceValidationError(f"Cannot read manifest JSON: {error}") from error

    if not isinstance(value, dict):
        raise SourceValidationError("Manifest root must be a JSON object")
    if value.get("manifest_version") != 1:
        raise SourceValidationError("manifest_version must be 1")

    dataset_id = value.get("dataset_id")
    if not isinstance(dataset_id, str) or not _DATASET_ID.fullmatch(dataset_id):
        raise SourceValidationError("dataset_id must be a safe lowercase identifier")

    source_file = value.get("source_file")
    if (
        not isinstance(source_file, str)
        or not source_file
        or Path(source_file).name != source_file
        or "/" in source_file
        or "\\" in source_file
    ):
        raise SourceValidationError("source_file must be a basename without path separators")

    source_format = value.get("source_format")
    if source_format not in {"plain", "gzip"}:
        raise SourceValidationError("source_format must be 'plain' or 'gzip'")

    if value.get("graph_semantics") != "undirected_edge_list":
        raise SourceValidationError("graph_semantics must be 'undirected_edge_list'")

    for field in ("source_sha256", "uncompressed_sha256"):
        digest = value.get(field)
        if digest is not None and (not isinstance(digest, str) or not _SHA256.fullmatch(digest)):
            raise SourceValidationError(f"{field} must be a lowercase SHA-256 hex digest or null")

    byte_sizes: dict[str, int | None] = {}
    for field in ("source_bytes", "content_bytes"):
        size = value.get(field)
        if size is not None and (not isinstance(size, int) or isinstance(size, bool) or size < 0):
            raise SourceValidationError(f"{field} must be a non-negative integer or null")
        byte_sizes[field] = size

    acquired_at = _optional_string(value.get("acquired_at"), "acquired_at")
    if acquired_at is not None:
        try:
            parsed_acquired_at = datetime.fromisoformat(acquired_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise SourceValidationError("acquired_at must be an ISO-8601 timestamp or null") from error
        if parsed_acquired_at.tzinfo is None:
            raise SourceValidationError("acquired_at must include a timezone")

    strings: dict[str, str] = {}
    for field in ("citation", "rights_status", "schema_version", "transform_version", "quality_policy_version"):
        item = value.get(field)
        if not isinstance(item, str) or not item.strip():
            raise SourceValidationError(f"{field} must be a non-empty string")
        strings[field] = item

    expected = value.get("expected_reference_counts")
    if expected is not None and not isinstance(expected, dict):
        raise SourceValidationError("expected_reference_counts must be an object or null")

    return SourceManifest(
        manifest_version=1,
        dataset_id=dataset_id,
        source_file=source_file,
        source_format=source_format,
        graph_semantics="undirected_edge_list",
        source_sha256=_optional_string(value.get("source_sha256"), "source_sha256"),
        uncompressed_sha256=_optional_string(value.get("uncompressed_sha256"), "uncompressed_sha256"),
        source_bytes=byte_sizes["source_bytes"],
        content_bytes=byte_sizes["content_bytes"],
        acquired_at=acquired_at,
        source_url=_optional_string(value.get("source_url"), "source_url"),
        citation=strings["citation"],
        rights_status=strings["rights_status"],
        rights_evidence=_optional_string(value.get("rights_evidence"), "rights_evidence"),
        schema_version=strings["schema_version"],
        transform_version=strings["transform_version"],
        quality_policy_version=strings["quality_policy_version"],
        expected_reference_counts=expected,
    )


def _hash_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _logical_lines(content: bytes) -> list[bytes]:
    lines = content.split(b"\n")
    if content.endswith(b"\n"):
        lines.pop()
    return [line[:-1] if line.endswith(b"\r") else line for line in lines]


def validate_source(path: Path, manifest: SourceManifest) -> ValidatedSource:
    if manifest.rights_status not in {"synthetic", "approved"}:
        raise SourceValidationError(
            f"Source usage rights are not approved (rights_status={manifest.rights_status!r})"
        )
    if manifest.rights_status == "approved" and (
        not manifest.rights_evidence or not manifest.source_url or not manifest.acquired_at
    ):
        raise SourceValidationError(
            "Approved external sources require rights_evidence, source_url, and acquired_at"
        )
    if manifest.rights_status == "synthetic" and not manifest.rights_evidence:
        raise SourceValidationError("Synthetic sources require rights_evidence")
    if (
        manifest.source_sha256 is None
        or manifest.uncompressed_sha256 is None
        or manifest.source_bytes is None
        or manifest.content_bytes is None
    ):
        raise SourceValidationError("Source/decompressed SHA-256 and byte-size pins are required before processing")

    try:
        source_path = path.resolve(strict=True)
        if not source_path.is_file():
            raise SourceValidationError(f"Source is not a regular file: {path}")
        if path.is_symlink():
            raise SourceValidationError("Source path must not be a symbolic link")
        if source_path.name != manifest.source_file:
            raise SourceValidationError(
                f"Source basename {source_path.name!r} does not match manifest source_file "
                f"{manifest.source_file!r}"
            )
        source_bytes = source_path.read_bytes()
    except FileNotFoundError as error:
        raise SourceValidationError(f"Source file not found: {path}") from error
    except OSError as error:
        raise SourceValidationError(f"Cannot read source file: {error}") from error

    if not source_bytes:
        raise SourceValidationError("Source is empty")

    source_sha256 = _hash_bytes(source_bytes)
    if source_sha256 != manifest.source_sha256:
        raise SourceValidationError(
            f"Source SHA-256 mismatch: expected {manifest.source_sha256}, got {source_sha256}"
        )
    if len(source_bytes) != manifest.source_bytes:
        raise SourceValidationError(
            f"Source byte-size mismatch: expected {manifest.source_bytes}, got {len(source_bytes)}"
        )

    try:
        content = gzip.decompress(source_bytes) if manifest.source_format == "gzip" else source_bytes
    except (OSError, EOFError, zlib.error) as error:
        raise SourceValidationError(f"Invalid gzip source: {error}") from error

    if not content:
        raise SourceValidationError("Decompressed source is empty")
    if len(content) != manifest.content_bytes:
        raise SourceValidationError(
            f"Decompressed byte-size mismatch: expected {manifest.content_bytes}, got {len(content)}"
        )
    uncompressed_sha256 = _hash_bytes(content)
    if uncompressed_sha256 != manifest.uncompressed_sha256:
        raise SourceValidationError(
            "Decompressed SHA-256 mismatch: "
            f"expected {manifest.uncompressed_sha256}, got {uncompressed_sha256}"
        )

    records: list[tuple[int, str]] = []
    for line_number, raw_bytes in enumerate(_logical_lines(content), start=1):
        try:
            raw_text = raw_bytes.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise SourceValidationError(
                f"Source is not valid UTF-8 at line {line_number}: {error}"
            ) from error
        records.append((line_number, raw_text))

    if not records:
        raise SourceValidationError("Source contains no logical records")

    return ValidatedSource(
        manifest=manifest,
        source_path=source_path,
        source_version=source_sha256,
        source_sha256=source_sha256,
        uncompressed_sha256=uncompressed_sha256,
        source_bytes=len(source_bytes),
        content_bytes=len(content),
        records=tuple(records),
    )


def stable_record_id(source_version: str, source_file: str, line_number: int) -> str:
    value = f"{source_version}\0{source_file}\0{line_number}".encode("utf-8")
    return _hash_bytes(value)


def stable_run_id(
    manifest: SourceManifest,
    source_version: str,
    *,
    extra_config: dict[str, Any] | None = None,
) -> str:
    identity = {
        "dataset_id": manifest.dataset_id,
        "source_version": source_version,
        "schema_version": manifest.schema_version,
        "transform_version": manifest.transform_version,
        "quality_policy_version": manifest.quality_policy_version,
        "extra_config": extra_config or {},
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return _hash_bytes(canonical.encode("utf-8"))
