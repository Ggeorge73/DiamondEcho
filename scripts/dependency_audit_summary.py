"""Summarize raw, read-only production dependency audits for DE-34."""

import argparse
import json
from pathlib import Path


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Missing or invalid audit report: {path.name}") from exc


def summarize_npm(report):
    if not isinstance(report, dict) or not isinstance(report.get("vulnerabilities"), dict):
        raise ValueError("npm report is missing vulnerabilities")
    findings = []
    for name, details in report["vulnerabilities"].items():
        if not isinstance(details, dict) or not isinstance(details.get("severity"), str):
            raise ValueError(f"Invalid npm finding: {name}")
        findings.append({"package": name, "severity": details["severity"], "via": details.get("via", [])})
    return findings


def summarize_pip(report):
    if not isinstance(report, dict) or not isinstance(report.get("dependencies"), list):
        raise ValueError("pip-audit report is missing dependencies")
    findings = []
    for dependency in report["dependencies"]:
        if not isinstance(dependency, dict) or not isinstance(dependency.get("name"), str) or not isinstance(dependency.get("vulns"), list):
            raise ValueError("Invalid pip-audit dependency")
        for vulnerability in dependency["vulns"]:
            if not isinstance(vulnerability, dict) or not isinstance(vulnerability.get("id"), str):
                raise ValueError("Invalid pip-audit finding")
            findings.append({"package": dependency["name"], "version": dependency.get("version"), "id": vulnerability["id"], "fix_versions": vulnerability.get("fix_versions", [])})
    return findings


def build_summary(directory: Path, commit: str, statuses: dict):
    # Both tools use 0 for no findings and 1 for findings; any other or missing
    # status is a scan failure, not a clean report.
    for name, status in statuses.items():
        if status not in ("0", "1"):
            raise ValueError(f"{name} scan failed or did not run (exit {status or 'missing'})")
    if not (directory / "backend-runtime-frozen.txt").is_file():
        raise ValueError("Missing backend runtime package inventory")
    frontend = summarize_npm(_load_json(directory / "frontend.json"))
    staff = summarize_npm(_load_json(directory / "staff.json"))
    backend = summarize_pip(_load_json(directory / "backend.json"))
    findings = {"frontend": frontend, "staff": staff, "backend": backend}
    for name, rows in findings.items():
        if (statuses[name] == "0") != (len(rows) == 0):
            raise ValueError(f"{name} scanner exit disagrees with its report")
    summary = {"commit": commit, "status": "captured", "counts": {name: len(rows) for name, rows in findings.items()}, "findings": findings}
    lines = ["# Production dependency audit", "", f"Commit: `{commit}`", "", "| Scope | Finding count |", "| --- | ---: |"]
    for name, rows in findings.items():
        lines.append(f"| {name} | {len(rows)} |")
    lines += ["", "Counts are tool-specific: npm counts vulnerable packages in each workspace; pip-audit counts advisories across frozen backend runtime packages. Do not add them into a single deduplicated total or infer severity equivalence.", "", "This report records findings for triage; it does not approve risk or clear the launch gate. Review raw JSON and the frozen backend inventory before changing dependencies."]
    return summary, "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--frontend-status", default="")
    parser.add_argument("--staff-status", default="")
    parser.add_argument("--backend-status", default="")
    args = parser.parse_args()
    statuses = {"frontend": args.frontend_status, "staff": args.staff_status, "backend": args.backend_status}
    summary, markdown = build_summary(args.directory, args.commit, statuses)
    (args.directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (args.directory / "summary.md").write_text(markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
