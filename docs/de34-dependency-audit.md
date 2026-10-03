# DE-34 production dependency-audit evidence

The earlier DE-13 comment recorded 41 findings, including 21 high, on a 2026-09-26 scan. It is a historical observation, not the current count. Run the **Production dependency audit** workflow on the release-candidate commit (or review its run on a dependency PR), then attach its run URL and downloaded artifact to DE-34.

The workflow uses the repository's npm 10.9.3 lockfile and scans each production workspace separately with `npm audit --omit=dev`. For the backend, it installs only `backend/requirements-runtime.txt` in a clean Python 3.12 virtual environment, freezes the exact installed versions, and audits that frozen inventory with pinned `pip-audit` 2.10.1. It makes no dependency upgrades, no cloud changes, and no production deployment.

The artifact contains raw `frontend.json`, `staff.json`, `backend.json`, `build-toolchain.json`, the frozen backend inventory, and machine/human summaries. `build-toolchain.json` is `npm audit` for the whole lockfile, devDependencies included: build and test tools are not shipped, but they stay on the record so that classifying a package as a devDependency cannot make its findings disappear. The scanner exits with code 1 when it finds vulnerabilities; those findings are captured without failing the evidence workflow. A missing or malformed report, installation failure, or scanner error **does** fail the run. A green workflow therefore means a complete report was captured, not that dependencies are safe.

Triage each raw finding by advisory ID, affected package/version, deployment reachability, severity, fix or mitigation, owner, and retest evidence. npm counts vulnerable packages per workspace; pip-audit counts advisories, so their totals are not directly additive. The tools' severity schemes are not interchangeable. Any unresolved high/critical launch risk needs Gbenga's explicit decision. The QA agent verifies the exact release-candidate rerun and records evidence without claiming human Tiara's approval; DE-13 and DE-27 remain gated.

The first triage pass, covering the direct high-severity packages, is recorded in [de34-dependency-triage.md](de34-dependency-triage.md).
