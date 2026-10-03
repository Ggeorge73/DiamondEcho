import json
import tempfile
import unittest
from pathlib import Path

from dependency_audit_summary import build_summary


class AuditSummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        (self.directory / "backend-runtime-frozen.txt").write_text("fastapi==0.141.1\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def report(self, name, data):
        (self.directory / name).write_text(json.dumps(data), encoding="utf-8")

    def test_captures_findings_without_treating_them_as_scan_failure(self):
        self.report("frontend.json", {"vulnerabilities": {"example": {"severity": "high", "via": ["GHSA-test"]}}})
        self.report("staff.json", {"vulnerabilities": {}})
        self.report("backend.json", {"dependencies": [{"name": "fastapi", "version": "0.141.1", "vulns": [{"id": "PYSEC-test", "fix_versions": []}]}]})
        summary, markdown = build_summary(self.directory, "abc123", {"frontend": "1", "staff": "0", "backend": "1"})
        self.assertEqual(summary["counts"], {"frontend": 1, "staff": 0, "backend": 1})
        self.assertIn("does not approve risk", markdown)

    def test_reports_build_toolchain_scope_when_requested(self):
        self.report("frontend.json", {"vulnerabilities": {}})
        self.report("staff.json", {"vulnerabilities": {}})
        self.report("backend.json", {"dependencies": []})
        self.report("build-toolchain.json", {"vulnerabilities": {"dev-only": {"severity": "high", "via": ["GHSA-test"]}}})
        statuses = {"frontend": "0", "staff": "0", "backend": "0", "toolchain": "1"}
        summary, markdown = build_summary(self.directory, "abc123", statuses)
        self.assertEqual(summary["counts"], {"frontend": 0, "staff": 0, "backend": 0, "toolchain": 1})
        self.assertIn("not shipped", markdown)

    def test_requires_toolchain_report_when_requested(self):
        self.report("frontend.json", {"vulnerabilities": {}})
        self.report("staff.json", {"vulnerabilities": {}})
        self.report("backend.json", {"dependencies": []})
        with self.assertRaisesRegex(ValueError, "Missing or invalid"):
            build_summary(self.directory, "abc123", {"frontend": "0", "staff": "0", "backend": "0", "toolchain": "1"})

    def test_rejects_toolchain_scanner_errors(self):
        with self.assertRaisesRegex(ValueError, "scan failed"):
            build_summary(self.directory, "abc123", {"frontend": "0", "staff": "0", "backend": "0", "toolchain": ""})

    def test_rejects_scanner_errors(self):
        with self.assertRaisesRegex(ValueError, "scan failed"):
            build_summary(self.directory, "abc123", {"frontend": "2", "staff": "0", "backend": "0"})

    def test_rejects_missing_report(self):
        with self.assertRaisesRegex(ValueError, "Missing or invalid"):
            build_summary(self.directory, "abc123", {"frontend": "0", "staff": "0", "backend": "0"})

    def test_rejects_exit_report_disagreement(self):
        self.report("frontend.json", {"vulnerabilities": {"example": {"severity": "high"}}})
        self.report("staff.json", {"vulnerabilities": {}})
        self.report("backend.json", {"dependencies": []})
        with self.assertRaisesRegex(ValueError, "disagrees"):
            build_summary(self.directory, "abc123", {"frontend": "0", "staff": "0", "backend": "0"})


if __name__ == "__main__":
    unittest.main()
