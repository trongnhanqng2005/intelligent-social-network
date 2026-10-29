from __future__ import annotations

import unittest

from isn_etl.silver import parse_edge_text


class ParseEdgeTests(unittest.TestCase):
    def test_classifies_comments_and_blank_lines_without_losing_raw_text(self) -> None:
        self.assertEqual(parse_edge_text("  # comment"), ("comment", None, None, None))
        self.assertEqual(parse_edge_text(" \t "), ("blank", None, None, None))

    def test_parses_unsigned_decimal_edges_and_canonicalizes_undirected_ids(self) -> None:
        self.assertEqual(parse_edge_text("22 003"), ("valid", 3, 22, None))
        self.assertEqual(parse_edge_text("0 1"), ("valid", 0, 1, None))
        self.assertEqual(parse_edge_text("9223372036854775807 0"), ("valid", 0, 9223372036854775807, None))

    def test_rejects_wrong_column_count_and_non_ascii_or_signed_identifiers(self) -> None:
        self.assertEqual(parse_edge_text("1"), ("quarantine", None, None, "INVALID_COLUMN_COUNT"))
        self.assertEqual(parse_edge_text("1 2 3"), ("quarantine", None, None, "INVALID_COLUMN_COUNT"))
        for raw in ("-1 2", "+1 2", "1 x", "١ 2"):
            with self.subTest(raw=raw):
                self.assertEqual(parse_edge_text(raw)[3], "INVALID_IDENTIFIER")

    def test_rejects_signed_64_bit_overflow_and_self_loops(self) -> None:
        self.assertEqual(
            parse_edge_text("9223372036854775808 1"),
            ("quarantine", None, None, "IDENTIFIER_OUT_OF_RANGE"),
        )
        self.assertEqual(parse_edge_text("0001 1"), ("quarantine", None, None, "SELF_LOOP"))


if __name__ == "__main__":
    unittest.main()
