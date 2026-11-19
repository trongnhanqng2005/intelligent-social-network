from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score

SEED = 20261119
DATASET_ID = "synthetic-friend-rec-v1"
FEATURES = ("common_neighbors", "jaccard", "adamic_adar", "resource_allocation",
            "degree_sum", "degree_product")
GOLD_NODE_COLUMNS = ["dataset_id", "source_version", "node_id", "source_node_id"]
GOLD_EDGE_COLUMNS = ["dataset_id", "source_version", "node_id_low", "node_id_high"]
SERVING_SCHEMA = pa.schema([
    ("sourceNodeId", pa.string()), ("candidateNodeId", pa.string()), ("rank", pa.int32()),
    ("score", pa.float64()), ("modelVersion", pa.string()), ("computedAt", pa.timestamp("us", tz="UTC")),
])


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def create_graph(out_dir: Path, communities: int = 4, members: int = 12) -> dict[str, object]:
    if communities < 2 or members < 5:
        raise ValueError("Use at least two communities of five nodes")
    rng = random.Random(SEED)
    edges: set[tuple[int, int]] = set()
    for c in range(communities):
        start = c * members
        for i in range(members):
            edges.add(tuple(sorted((start + i, start + (i + 1) % members))))
        # Seeded heterogeneous within-community ties, with a hub for degree variation.
        for a in range(start, start + members):
            if a != start:
                edges.add((start, a))
            for b in range(a + 1, start + members):
                if rng.random() < (0.20 if (a - start) % 3 else 0.36):
                    edges.add((a, b))
    # Sparse seeded bridges, while preserving community structure.
    for c in range(communities):
        nxt = (c + 1) % communities
        for _ in range(max(1, members // 8)):
            a = c * members + rng.randrange(members)
            b = nxt * members + rng.randrange(members)
            edges.add(tuple(sorted((a, b))))
    content = "".join(f"{a} {b}\n" for a, b in sorted(edges)).encode("ascii")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "synthetic-edges.txt"
    path.write_bytes(content)
    digest = _sha(content)
    manifest = {
        "manifest_version": 1, "dataset_id": DATASET_ID, "source_file": path.name,
        "source_format": "plain", "graph_semantics": "undirected_edge_list",
        "source_sha256": digest, "uncompressed_sha256": digest,
        "source_bytes": len(content), "content_bytes": len(content),
        "citation": "Original seeded synthetic graph generated locally for this experiment.",
        "rights_status": "synthetic", "rights_evidence": "Generated locally; no external dataset or source.",
        "schema_version": "1.0.0", "transform_version": "1.0.0",
        "quality_policy_version": "1.0.0",
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return {"nodes": communities * members, "edges": len(edges), "source_sha256": digest,
            "source_bytes": len(content), "manifest_path": str(out_dir / "manifest.json")}


def _publish_output(output_dir: Path, write) -> dict[str, object]:
    if os.path.lexists(output_dir):
        raise FileExistsError(f"Output directory must be new: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".friend-rec-", dir=output_dir.parent) as temporary:
        payload = Path(temporary) / "payload"
        result = write(payload)
        if os.path.lexists(output_dir):
            raise FileExistsError(f"Output directory must be new: {output_dir}")
        os.rename(payload, output_dir)
        if result.get("manifest_path"):
            result["manifest_path"] = str(output_dir / "manifest.json")
        return result


def read_gold(run_root: Path) -> tuple[list[str], list[tuple[str, str]], dict[str, Any]]:
    marker_path, manifest_path = run_root / "_COMPLETE.json", run_root / "_RUN_MANIFEST.json"
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if (marker.get("status") != "complete" or marker.get("completion_version") != 1
            or marker.get("run_id") != manifest.get("run_id")
            or marker.get("run_manifest_sha256") != _sha(manifest_bytes)
            or manifest.get("status") != "validated"):
        raise ValueError("Completion marker and validated run manifest do not match")
    if manifest.get("rights_status") != "synthetic":
        raise ValueError("Only synthetic source provenance is allowed")
    outputs = manifest.get("outputs", {})
    tables = {}
    for name, columns in (("gold/nodes", GOLD_NODE_COLUMNS), ("gold/edges", GOLD_EDGE_COLUMNS)):
        spec = outputs.get(name)
        schema_names = [f.get("name") for f in spec.get("schema", {}).get("fields", [])] if isinstance(spec, dict) else []
        schema_types = [f.get("type") for f in spec.get("schema", {}).get("fields", [])] if isinstance(spec, dict) else []
        expected_types = ["string", "string", "string", "long"] if name == "gold/nodes" else ["string"] * 4
        if schema_names != columns or schema_types != expected_types:
            raise ValueError(f"{name} schema mismatch")
        table_path = run_root / name
        expected = spec.get("files", {})
        paths = sorted(table_path.rglob("*.parquet"))
        actual_names = {p.relative_to(table_path).as_posix() for p in paths}
        if not paths or actual_names != set(expected):
            raise ValueError(f"{name} Parquet inventory mismatch")
        for p in paths:
            relative = p.relative_to(table_path).as_posix()
            if expected[relative] != {"bytes": p.stat().st_size, "sha256": _sha(p.read_bytes())}:
                raise ValueError(f"{name} Parquet file hash/size mismatch: {relative}")
        table = pq.read_table(paths)
        expected_types = (["string", "string", "string", "int64"] if name == "gold/nodes"
                          else ["string", "string", "string", "string"])
        if (table.column_names != columns or [str(t) for t in table.schema.types] != expected_types
                or table.num_rows != spec.get("row_count")):
            raise ValueError(f"{name} actual Parquet schema/row count mismatch")
        tables[name] = table.to_pylist()
    nodes_rows, edge_rows = tables["gold/nodes"], tables["gold/edges"]
    node_to_source: dict[str, int] = {}
    for row in nodes_rows:
        source_id = row["source_node_id"]
        if (row["dataset_id"] != manifest.get("dataset_id")
                or row["source_version"] != manifest.get("source_version")
                or not isinstance(source_id, int) or isinstance(source_id, bool) or source_id < 0
                or row["node_id"] != f'{row["dataset_id"]}:{source_id}'):
            raise ValueError("Gold node identity/provenance invalid")
        node_to_source[row["node_id"]] = source_id
    ids = [r["node_id"] for r in nodes_rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate Gold node ID")
    nodes = sorted(ids, key=node_to_source.__getitem__)
    node_set = set(nodes)
    edges = []
    for row in edge_rows:
        low, high = row["node_id_low"], row["node_id_high"]
        if (row["dataset_id"] != manifest.get("dataset_id") or
                row["source_version"] != manifest.get("source_version") or
                low not in node_set or high not in node_set or
                node_to_source[low] >= node_to_source[high]):
            raise ValueError("Gold edge provenance, canonical order, or endpoint invalid")
        edges.append((low, high))
    if len(edges) != len(set(edges)):
        raise ValueError("Duplicate Gold edge")
    return nodes, sorted(edges, key=lambda edge: (node_to_source[edge[0]], node_to_source[edge[1]])), manifest


def _features(graph: dict[int, set[int]], pair: tuple[int, int]) -> list[float]:
    a, b = pair
    common = graph[a] & graph[b]
    union = graph[a] | graph[b]
    return [float(len(common)), len(common) / len(union) if union else 0.0,
            sum(1 / math.log(len(graph[n])) for n in common if len(graph[n]) > 1),
            sum(1 / len(graph[n]) for n in common if graph[n]),
            float(len(graph[a]) + len(graph[b])), float(len(graph[a]) * len(graph[b]))]


def _ranking_metrics(pairs, scores, positives, nodes):
    positive_by_source = {n: set() for n in nodes}
    ranked = {n: [] for n in nodes}
    for (a, b), score, label in zip(pairs, scores, [int(p in positives) for p in pairs]):
        if label:
            positive_by_source[a].add(b)
            positive_by_source[b].add(a)
        ranked[a].append((score, b))
        ranked[b].append((score, a))
    result = {}
    for k in (5, 10):
        precisions, recalls = [], []
        endpoints = [n for n in nodes if positive_by_source[n]]
        for n in endpoints:
            top = sorted(ranked[n], key=lambda x: (-x[0], x[1]))[:k]
            hits = sum(candidate in positive_by_source[n] for _, candidate in top)
            if positive_by_source[n]:
                recalls.append(hits / len(positive_by_source[n]))
            precisions.append(hits / k)
        result[f"precision@{k}"] = float(np.mean(precisions)) if precisions else 0.0
        result[f"recall@{k}"] = float(np.mean(recalls)) if recalls else 0.0
    return result


def _negative_pools(edge_set: set[tuple[int, int]], node_count: int, train_count: int):
    nonedges = [(a, b) for a in range(node_count) for b in range(a + 1, node_count)
                if (a, b) not in edge_set]
    if len(nonedges) < train_count + 2:
        raise ValueError("Insufficient nonedges for disjoint negative pools")
    rng = random.Random(SEED + 1)
    rng.shuffle(nonedges)
    train = nonedges[:train_count]
    remaining = nonedges[train_count:]
    split = len(remaining) // 2
    return train, remaining[:split], remaining[split:]


def train_and_evaluate(rows: list[tuple[str, str]], out_dir: Path, *,
                       node_ids: list[str] | None = None, provenance: dict[str, Any] | None = None,
                       computed_at: datetime | None = None):
    if out_dir.exists():
        raise FileExistsError(f"Output directory must be new: {out_dir}")
    node_ids = sorted(node_ids or {x for pair in rows for x in pair},
                      key=lambda value: int(value.rsplit(":", 1)[1]))
    ids = {value: i for i, value in enumerate(node_ids)}
    edges = sorted({tuple(sorted((ids[a], ids[b]))) for a, b in rows})
    if len(edges) < 10 or len(node_ids) < 4:
        raise ValueError("Graph is too small for the required split")
    rng = random.Random(SEED)
    shuffled = edges.copy()
    rng.shuffle(shuffled)
    n = len(edges)
    n_observed, ntrain, nval = int(n * .7), int(n * .1), int(n * .1)
    observed = shuffled[:n_observed]
    train_pos = shuffled[n_observed:n_observed+ntrain]
    val_pos = shuffled[n_observed+ntrain:n_observed+ntrain+nval]
    test_pos = shuffled[n_observed+ntrain+nval:]
    full_set = set(edges)
    train_neg, val_neg, test_neg = _negative_pools(full_set, len(node_ids), ntrain)
    observed_graph = {i: set() for i in range(len(node_ids))}
    full_graph = {i: set() for i in range(len(node_ids))}
    for a, b in observed:
        observed_graph[a].add(b); observed_graph[b].add(a)
    for a, b in edges:
        full_graph[a].add(b); full_graph[b].add(a)
    def matrix(pairs):
        return np.asarray([_features(observed_graph, p) for p in pairs], dtype=np.float64)
    tx = matrix(train_pos + train_neg)
    ty = np.array([1] * len(train_pos) + [0] * len(train_neg))
    vx = matrix(val_pos + val_neg)
    vy = np.array([1] * len(val_pos) + [0] * len(val_neg))
    choices = []
    for c in (.1, 1, 10):
        model = LogisticRegression(C=c, random_state=SEED, max_iter=1000, solver="liblinear")
        model.fit(tx, ty)
        score = model.predict_proba(vx)[:, 1]
        metrics = _ranking_metrics(val_pos + val_neg, score, set(val_pos), range(len(node_ids)))
        ap = float(average_precision_score(vy, score))
        choices.append((metrics["recall@10"], ap, -c, c, model))
    _, _, _, best_c, model = max(choices)
    test_pos_pairs, test_pairs = test_pos, test_pos + test_neg
    test_y = np.array([1] * len(test_pos) + [0] * len(test_neg))
    test_x = matrix(test_pairs)
    lr_scores = model.predict_proba(test_x)[:, 1]
    cn_scores = np.asarray([_features(observed_graph, p)[0] for p in test_pairs])
    def report(scores):
        return {"counts": {"positive_pairs": len(test_pos), "negative_pairs": len(test_neg),
                           "positive_source_endpoints": len({v for pair in test_pos for v in pair})},
                "precision_recall": _ranking_metrics(test_pairs, scores, set(test_pos), range(len(node_ids))),
                "roc_auc": float(roc_auc_score(test_y, scores)),
                 "average_precision": float(average_precision_score(test_y, scores)),
                 "observed_node_coverage": len({v for pair in observed for v in pair}) / len(node_ids),
                 "serving_source_coverage": sum(any(tuple(sorted((source, target))) not in full_set
                                                    for target in range(len(node_ids)) if target != source)
                                                for source in range(len(node_ids))) / len(node_ids)}
    metrics = {
        "seed": SEED, "nodes": len(node_ids), "gold_edges": len(edges),
        **(provenance or {}),
        "features": list(FEATURES), "selected_C": best_c,
        "split": {"observed_edges": len(observed), "train_positive": len(train_pos), "validation_positive": len(val_pos),
                  "test_positive": len(test_pos), "train_negative": len(train_neg),
                  "validation_negative": len(val_neg), "test_negative": len(test_neg),
                  "training_sampling_ratio": f"1:{len(train_neg)/len(train_pos):.6g}"},
        "cn_baseline": report(cn_scores), "logistic_regression": report(lr_scores),
        "audit_sha256": {"train_positive": _sha(repr(train_pos).encode()),
                         "validation_positive": _sha(repr(val_pos).encode()),
                         "test_positive": _sha(repr(test_pos).encode()),
                         "observed_edges": _sha(repr(observed).encode()),
                         "train_negative": _sha(repr(train_neg).encode()),
                         "validation_negative": _sha(repr(val_neg).encode()),
                         "test_negative": _sha(repr(test_neg).encode())},
    }
    timestamp = computed_at or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        raise ValueError("computed_at must be timezone-aware")
    timestamp = timestamp.astimezone(timezone.utc)
    serving = []
    model_version = f"friend-rec-logreg-c{best_c:g}-v1"
    for source in range(len(node_ids)):
        eligible = [(target, _features(full_graph, tuple(sorted((source, target)))))
                    for target in range(len(node_ids)) if target != source and tuple(sorted((source, target))) not in full_set]
        if eligible:
            probs = model.predict_proba(np.asarray([f for _, f in eligible]))[:, 1]
            for rank, (target, score) in enumerate(sorted(zip((x[0] for x in eligible), probs),
                                                          key=lambda x: (-x[1], node_ids[x[0]]))[:10], 1):
                serving.append((node_ids[source], node_ids[target], rank, float(score), model_version, timestamp))
    out_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist([dict(zip(SERVING_SCHEMA.names, r)) for r in serving], schema=SERVING_SCHEMA),
                   out_dir / "recommendations.parquet")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n",
                                          encoding="utf-8", newline="\n")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline synthetic friend recommendation experiment.")
    sub = parser.add_subparsers(dest="command", required=True)
    generate = sub.add_parser("generate", help="Generate original synthetic ETL source and manifest")
    generate.add_argument("--output-dir", type=Path, required=True)
    evaluate = sub.add_parser("evaluate", help="Validate a completed Spark run and evaluate offline")
    evaluate.add_argument("--run-root", type=Path, required=True)
    evaluate.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "generate":
        result = _publish_output(args.output_dir, create_graph)
    else:
        nodes, edges, manifest = read_gold(args.run_root)
        result = _publish_output(args.output_dir, lambda payload: train_and_evaluate(
            edges, payload, node_ids=nodes,
            provenance={"source_sha256": manifest["source_sha256"], "run_id": manifest["run_id"]}))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
