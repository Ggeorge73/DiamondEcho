#!/usr/bin/env bash
# Finish what a killed deploy.sh run could not: give all traffic back to the
# revision that served before it, and remove the candidate tag. For the
# workflow step that runs after a cancelled or failed deploy
# (.github/workflows/sre-deploy-api.yml); it works the same by hand.
#
#   bash scripts/sre/cloudrun/cleanup.sh --state FILE [--apply]
#
# FILE is deploy.sh's DEPLOY_STATE_FILE (prev=, new=, done= lines). Nothing is
# done when the file is missing (the deploy never started), says done=1 (the
# deploy finished: never undo a finished deploy), or when the old revision
# already has all the traffic and no candidate tag is left. Without --apply it
# only reads and says what it would do.
#
# Exit 0: nothing to do, done, or dry run. Exit 1: rollback.sh moved the
# traffic but the old revision is not healthy. Exit 2: could not do it.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STATE=""
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --state) [ $# -ge 2 ] || die "--state needs a file."; STATE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: $1. Usage: cleanup.sh --state FILE [--apply]" ;;
  esac
done
[ -n "$STATE" ] || die "Say which state file: cleanup.sh --state FILE [--apply]"
if [ ! -f "$STATE" ]; then
  say "No deploy state: the deploy stopped before it read the service. Nothing to clean up."
  exit 0
fi
if grep -qx 'done=1' "$STATE"; then
  say "The deploy finished. Nothing to undo."
  exit 0
fi
PREV="$(sed -n 's/^prev=//p' "$STATE" | head -n 1)"
is_revision_name "$PREV" || die "The state file names no revision to return to."

need gcloud node curl
check_names
make_work
trap 'rm -rf "$WORK"' EXIT
describe_service "$WORK/service.json"
list_revisions "$WORK/revisions.json"
helper status "$WORK/service.json" "$WORK/revisions.json" > "$WORK/status.json"
read -r SPLIT TAGGED < <(node -e '
  const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const settled = doc.serving.length === 1 && doc.serving[0].revision === process.argv[2] && doc.serving[0].percent === 100;
  const tagged = doc.tags.some((item) => item.tag === "candidate");
  process.stdout.write(`${settled ? "no" : "yes"} ${tagged ? "yes" : "no"}\n`);' "$WORK/status.json" "$PREV")

if [ "$SPLIT" = no ] && [ "$TAGGED" = no ]; then
  say "$PREV has all the traffic and no candidate tag is left. Nothing to clean up."
  exit 0
fi
code=0
if [ "$SPLIT" = yes ]; then
  say "The traffic is not all on $PREV: giving it back."
  if [ "$APPLY" = 1 ]; then
    bash "$CLOUDRUN_DIR/rollback.sh" --to "$PREV" --apply || code=$?
  else
    bash "$CLOUDRUN_DIR/rollback.sh" --to "$PREV" || code=$?
  fi
fi
if [ "$TAGGED" = yes ]; then
  say "Removing the candidate tag."
  change gcloud run services update-traffic "$SERVICE" --remove-tags candidate --project "$PROJECT" --region "$REGION" >&2 \
    || { say "WARNING: could not remove the candidate tag."; [ "$code" != 0 ] || code=2; }
fi
[ "$APPLY" = 1 ] || say "Dry run: nothing was changed. Add --apply to do it."
exit "$code"
