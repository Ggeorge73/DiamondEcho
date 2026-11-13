#!/usr/bin/env bash
# Give all the traffic of the Cloud Run service to a named, ready revision.
# This is the rollback: the revision already exists, nothing is built, and
# the change takes a few seconds.
#
#   bash scripts/sre/cloudrun/rollback.sh --to REVISION [--apply]
#
# Without --apply it only reads, and prints the exact command it would run.
# It refuses a revision that does not belong to the service or is not ready.
# With --apply it runs the command, reads the traffic back and asks /health.
#
# The last line of standard output is one JSON object:
#   {"action":"cloud-run-rollback","applied":true,"service":"…","from":[…],
#    "to":"…","command":"gcloud …","verified":true}
# Exit 0: the revision has all the traffic and answers (or dry run, or it
#         already had all the traffic).
# Exit 1: the traffic was moved, but the service did not answer healthy after.
# Exit 2: refused or failed; the traffic was not confirmed on the revision.
#
# After a rollback the service is pinned to that revision: a later settings
# change (`gcloud run services update …`) makes a new revision that gets NO
# traffic. See docs/sre/release-safety.md, "After a rollback".
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TARGET=""
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) [ $# -ge 2 ] || die "--to needs a revision name."; TARGET="$2"; shift 2 ;;
    --to=*) TARGET="${1#--to=}"; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: $1. Usage: rollback.sh --to REVISION [--apply]" ;;
  esac
done
[ -n "$TARGET" ] || die "Say which revision: rollback.sh --to REVISION [--apply]. List them with status.sh."
is_revision_name "$TARGET" || die "Not a revision name: $TARGET"

need gcloud node curl
check_names
make_work
trap 'rm -rf "$WORK"' EXIT

describe_service "$WORK/service.json"
list_revisions "$WORK/revisions.json"
FROM="$(helper serving-json "$WORK/service.json")"
IFS=$'\t' read -r SERVICE_URL _ _ _ < <(helper service-facts "$WORK/service.json")

COMMAND=(gcloud run services update-traffic "$SERVICE" "--to-revisions=${TARGET}=100" --project "$PROJECT" --region "$REGION")
result() { # applied verified
  printf '{"action":"cloud-run-rollback","applied":%s,"service":%s,"from":%s,"to":%s,"command":%s,"verified":%s}\n' \
    "$1" "$(helper json-string "$SERVICE")" "$FROM" "$(helper json-string "$TARGET")" "$(helper json-string "$(shown "${COMMAND[@]}")")" "$2"
}

case "$(helper rollback-target "$WORK/service.json" "$WORK/revisions.json" "$TARGET")" in
  unknown) die "Refused: $TARGET is not a revision of $SERVICE in $PROJECT ($REGION). List them with status.sh." ;;
  not-ready) die "Refused: $TARGET is not ready, so it cannot answer visitors." ;;
  already)
    say "$TARGET already has all the traffic of $SERVICE. Nothing to do."
    result false null
    exit 0 ;;
  ok) ;;
  *) die "Could not judge the revision $TARGET." ;;
esac

say "Service $SERVICE in $PROJECT ($REGION). Serving now: $FROM"
say "Rollback: all traffic to $TARGET."
if [ "$APPLY" != 1 ]; then
  change "${COMMAND[@]}"
  say "Dry run: nothing was changed. Add --apply to run the command above."
  result false null
  exit 0
fi

change "${COMMAND[@]}" >&2 || die "The traffic command failed. Run status.sh to see what is serving."

# Read it back: the answer to trust is what Cloud Run says is serving now.
describe_service "$WORK/after.json"
NOW="$(helper serving "$WORK/after.json")"
if [ "$NOW" != "$(printf '%s\t100' "$TARGET")" ]; then
  say "ERROR: after the command, the traffic is not all on $TARGET. Serving now:"
  say "$NOW"
  result true false
  exit 2
fi
say "Traffic: $TARGET, 100 percent."

# The revision must also answer. A first request may wake a sleeping
# instance, so it gets a few tries.
VERIFIED=false
if [ "$SERVICE_URL" != "-" ]; then
  for _ in 1 2 3; do
    if health_ok "$SERVICE_URL"; then VERIFIED=true; break; fi
    sleep "${ROLLBACK_RETRY_SECONDS:-5}"
  done
fi
result true "$VERIFIED"
if [ "$VERIFIED" != true ]; then
  say "WARNING: the traffic is on $TARGET but /health did not answer 200 (last status $HTTP_STATUS)."
  say "Follow docs/sre/runbooks/api-down.md."
  exit 1
fi
say "Rolled back: $TARGET answers /health."
