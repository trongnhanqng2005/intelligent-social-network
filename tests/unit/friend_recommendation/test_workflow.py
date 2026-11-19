from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from friend_recommendation import workflow as wf


class WorkflowTests(unittest.TestCase):
    def test_seeded_source_and_exact_manifest_pins(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "synthetic-edges.txt"
            wf.create_graph(p)
            raw = p.read_bytes()
            manifest = json.loads((p.parent / "manifest.json").read_text())
            self.assertTrue(raw.endswith(b"\n"))
            self.assertNotIn(b"\r\n", raw)
            self.assertEqual(manifest["source_sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(manifest["source_bytes"], len(raw))
            self.assertEqual(manifest["rights_status"], "synthetic")

    def test_hand_calculated_features(self):
        graph = {0: {1, 2}, 1: {0, 2}, 2: {0, 1, 3}, 3: {2}}
        self.assertEqual(wf._features(graph, (0, 1)),
                         [1.0, 1 / 3, 1 / __import__("math").log(3), 1 / 3, 4.0, 4.0])
        self.assertEqual(wf._features(graph, (0, 3)),
                         [1.0, 1 / 2, 1 / __import__("math").log(3), 1 / 3, 3.0, 2.0])

    def test_ranking_metrics_use_both_directions_and_fixed_k(self):
        pairs = [(0, 1), (0, 2), (1, 2), (2, 3)]
        metrics = wf._ranking_metrics(pairs, [0.9, 0.8, 0.7, 0.6], {(0, 1)}, range(4))
        self.assertEqual(metrics["precision@5"], 0.2)
        self.assertEqual(metrics["recall@5"], 1.0)
        self.assertEqual(metrics["precision@10"], 0.1)
        self.assertEqual(metrics["recall@10"], 1.0)

    def test_negative_pools_are_valid_disjoint_complete_graph_nonedges(self):
        edges = {(0, 1), (1, 2), (2, 3)}
        pools = wf._negative_pools(edges, 5, 2)
        self.assertEqual(len(set(pools[0]) | set(pools[1]) | set(pools[2])),
                         sum(map(len, pools)))
        self.assertFalse(any(pair in edges for pool in pools for pair in pool))
        self.assertEqual(len(pools[0]), 2)
        self.assertTrue(all(0 <= a < b < 5 for pool in pools for a, b in pool))

    def _rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "source.txt"
            wf.create_graph(p)
            # Synthetic source has IDs suitable for analytical namespace conversion.
            return [(f"{wf.DATASET_ID}:{a}", f"{wf.DATASET_ID}:{b}")
                    for line in p.read_text().splitlines() for a, b in [map(int, line.split())]]

    def test_split_reproducibility_leakage_and_serving_contract(self):
        rows = self._rows()
        with tempfile.TemporaryDirectory() as tmp:
            fixed = datetime(2026, 1, 1, tzinfo=timezone.utc)
            first = wf.train_and_evaluate(rows, Path(tmp) / "a", computed_at=fixed)
            second = wf.train_and_evaluate(rows, Path(tmp) / "b", computed_at=fixed)
            self.assertEqual(first, second)
            split = first["split"]
            self.assertEqual(split["observed_edges"] + split["train_positive"] +
                             split["validation_positive"] + split["test_positive"], len(rows))
            self.assertEqual(split["train_positive"], split["train_negative"])
            self.assertGreater(split["validation_negative"], 0)
            self.assertGreater(split["test_negative"], 0)
            table = pq.read_table(Path(tmp) / "a" / "recommendations.parquet")
            self.assertEqual(table.schema, wf.SERVING_SCHEMA)
            self.assertTrue(all(value.utcoffset().total_seconds() == 0
                                for value in table["computedAt"].to_pylist()))
            edge_set = {tuple(sorted(pair)) for pair in rows}
            for source, candidate in zip(table["sourceNodeId"].to_pylist(),
                                         table["candidateNodeId"].to_pylist()):
                self.assertNotEqual(source, candidate)
                self.assertNotIn(tuple(sorted((source, candidate))), edge_set)
            self.assertEqual(first["selected_C"], second["selected_C"])

    def test_gold_marker_manifest_schema_hash_and_endpoint_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset = wf.DATASET_ID
            source_ids = [2, 10, 11, 20]
            nodes = [{"dataset_id": dataset, "source_version": "1.0.0",
                      "node_id": f"{dataset}:{i}", "source_node_id": i} for i in source_ids]
            edges = [{"dataset_id": dataset, "source_version": "1.0.0",
                      "node_id_low": f"{dataset}:{a}", "node_id_high": f"{dataset}:{b}"}
                     for a, b in [(2, 10), (10, 11), (11, 20), (2, 20), (2, 11), (10, 20)]]
            outputs = {}
            for name, data, fields, types in (
                ("gold/nodes", nodes, wf.GOLD_NODE_COLUMNS, [pa.string(), pa.string(), pa.string(), pa.int64()]),
                ("gold/edges", edges, wf.GOLD_EDGE_COLUMNS, [pa.string()] * 4)):
                path = root / name
                path.mkdir(parents=True)
                table = pa.Table.from_pylist(data, schema=pa.schema(zip(fields, types)))
                file = path / "part-00000.parquet"
                pq.write_table(table, file)
                outputs[name] = {"row_count": len(data), "schema": {"fields": [
                    {"name": f, "type": ("long" if name == "gold/nodes" and f == "source_node_id" else "string")}
                    for f in fields]},
                                 "files": {file.name: {"bytes": file.stat().st_size,
                                                       "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}}}
            manifest = {"run_id": "r", "status": "validated", "dataset_id": dataset,
                        "source_version": "1.0.0", "rights_status": "synthetic", "outputs": outputs}
            manifest_bytes = json.dumps(manifest).encode()
            (root / "_RUN_MANIFEST.json").write_bytes(manifest_bytes)
            (root / "_COMPLETE.json").write_text(json.dumps(
                {"status": "complete", "completion_version": 1, "run_id": "r",
                 "run_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}))
            ns, es, _ = wf.read_gold(root)
            self.assertEqual(len(ns), 4)
            self.assertEqual(len(es), 6)
            self.assertLess(ns.index(f"{dataset}:2"), ns.index(f"{dataset}:10"))
            unexpected = root / "gold/edges/unexpected.parquet"
            unexpected.write_bytes((root / "gold/edges/part-00000.parquet").read_bytes())
            with self.assertRaisesRegex(ValueError, "inventory"):
                wf.read_gold(root)
            unexpected.unlink()
            bad = json.loads((root / "_COMPLETE.json").read_text())
            bad["run_manifest_sha256"] = "0" * 64
            (root / "_COMPLETE.json").write_text(json.dumps(bad))
            with self.assertRaises(ValueError):
                wf.read_gold(root)
            (root / "_COMPLETE.json").write_text(json.dumps({
                "status": "complete", "completion_version": 1, "run_id": "r",
                "run_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}))
            gold_edge_file = root / "gold/edges/part-00000.parquet"
            gold_edge_file.write_bytes(gold_edge_file.read_bytes() + b"corrupt")
            with self.assertRaises(ValueError):
                wf.read_gold(root)

    def test_gold_numeric_order_rejects_reversed_two_and_ten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_gold_fixture(root)
            edge_file = next((root / "gold/edges").glob("*.parquet"))
            table = pq.read_table(edge_file)
            rows = table.to_pylist()
            rows[0]["node_id_low"], rows[0]["node_id_high"] = (
                f"{wf.DATASET_ID}:10", f"{wf.DATASET_ID}:2")
            pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), edge_file)
            manifest_path = root / "_RUN_MANIFEST.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["outputs"]["gold/edges"]["files"][edge_file.name] = {
                "bytes": edge_file.stat().st_size,
                "sha256": hashlib.sha256(edge_file.read_bytes()).hexdigest()}
            manifest_bytes = json.dumps(manifest).encode()
            manifest_path.write_bytes(manifest_bytes)
            (root / "_COMPLETE.json").write_text(json.dumps({
                "status": "complete", "completion_version": 1, "run_id": "r",
                "run_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}))
            with self.assertRaisesRegex(ValueError, "canonical order"):
                wf.read_gold(root)

    def _write_gold_fixture(self, root):
        dataset = wf.DATASET_ID
        nodes = [{"dataset_id": dataset, "source_version": "1.0.0",
                  "node_id": f"{dataset}:{i}", "source_node_id": i} for i in (2, 10, 11, 20)]
        edges = [{"dataset_id": dataset, "source_version": "1.0.0",
                  "node_id_low": f"{dataset}:{a}", "node_id_high": f"{dataset}:{b}"}
                 for a, b in ((2, 10), (10, 11), (11, 20), (2, 20), (2, 11), (10, 20))]
        outputs = {}
        for name, data, fields, types in (
            ("gold/nodes", nodes, wf.GOLD_NODE_COLUMNS, [pa.string(), pa.string(), pa.string(), pa.int64()]),
            ("gold/edges", edges, wf.GOLD_EDGE_COLUMNS, [pa.string()] * 4)):
            path = root / name
            path.mkdir(parents=True)
            table = pa.Table.from_pylist(data, schema=pa.schema(zip(fields, types)))
            file = path / "part-00000.parquet"
            pq.write_table(table, file)
            outputs[name] = {"row_count": len(data), "schema": {"fields": [
                {"name": f, "type": ("long" if name == "gold/nodes" and f == "source_node_id" else "string")}
                for f in fields]}, "files": {file.name: {"bytes": file.stat().st_size,
                                                         "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}}}
        manifest = {"run_id": "r", "status": "validated", "dataset_id": dataset,
                    "source_version": "1.0.0", "rights_status": "synthetic", "outputs": outputs}
        manifest_bytes = json.dumps(manifest).encode()
        (root / "_RUN_MANIFEST.json").write_bytes(manifest_bytes)
        (root / "_COMPLETE.json").write_text(json.dumps({
            "status": "complete", "completion_version": 1, "run_id": "r",
            "run_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}))


if __name__ == "__main__":
    unittest.main()
