#!/usr/bin/env bash
# Which Cloud Run revisions answer visitors now, and which exist. Read-only.
#
#   bash scripts/sre/cloudrun/status.sh
#
# Prints one line of JSON (shape fixed by scripts/sre/README.md):
#   {"serving":[{"revision":"…","percent":100}],
#    "tags":[{"tag":"candidate","revision":"…"}],
#    "revisions":[{"name":"…","created":"…","ready":true,"image":"…","settings":"…"}]}
# tags: every traffic tag (a "candidate" tag means a deploy is in progress or
# was left behind). Each revision also has its container image and a
# fingerprint of every other setting, so new code and a settings change can
# be told apart without printing any setting's value.
# Revisions are newest first. Exit 0: printed. Exit 2: could not read.
# The service is chosen by GCP_PROJECT_ID, GCP_REGION and CLOUD_RUN_SERVICE
# (see lib.sh); the defaults are production.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "status.sh takes no arguments (got: $1)." ;;
esac

need gcloud node
check_names
make_work
trap 'rm -rf "$WORK"' EXIT

describe_service "$WORK/service.json"
list_revisions "$WORK/revisions.json"
helper status "$WORK/service.json" "$WORK/revisions.json"
