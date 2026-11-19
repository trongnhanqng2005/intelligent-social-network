from __future__ import annotations

import unittest

from isn_etl.silver import QualityAccountingError, validate_quality_accounting


class QualityAccountingTests(unittest.TestCase):
    def test_accepts_balanced_record_and_duplicate_accounting(self) -> None:
        validate_quality_accounting(
            total_records=10,
            blank_records=1,
            comment_records=1,
            candidate_records=8,
            quarantined_records=4,
            valid_edge_occurrences=4,
            unique_edges=2,
            duplicate_excess=2,
        )

    def test_rejects_each_broken_accounting_identity(self) -> None:
        base = {
            "total_records": 10,
            "blank_records": 1,
            "comment_records": 1,
            "candidate_records": 8,
            "quarantined_records": 4,
            "valid_edge_occurrences": 4,
            "unique_edges": 2,
            "duplicate_excess": 2,
        }
        for field, value in (
            ("candidate_records", 7),
            ("quarantined_records", 5),
            ("duplicate_excess", 1),
        ):
            changed = dict(base)
            changed[field] = value
            with self.subTest(field=field), self.assertRaises(QualityAccountingError):
                validate_quality_accounting(**changed)

    def test_rejects_negative_counts(self) -> None:
        with self.assertRaises(QualityAccountingError):
            validate_quality_accounting(
                total_records=-1,
                blank_records=0,
                comment_records=0,
                candidate_records=-1,
                quarantined_records=0,
                valid_edge_occurrences=0,
                unique_edges=0,
                duplicate_excess=0,
            )


if __name__ == "__main__":
    unittest.main()
