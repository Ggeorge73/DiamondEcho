#!/usr/bin/env bash
# Deploy the API to Cloud Run as a checked, gradual and reversible rollout.
# It is the hand procedure of docs/de13-production-setup.md ("API redeploy"),
# with every check written down as a command and a rollback on any failure.
#
#   bash scripts/sre/cloudrun/deploy.sh [--apply] [--commit SHA]
#
# Without --apply it only reads: it checks the checkout and the service and
# prints every command it would run. With --apply:
#   1. The checkout must be clean, at --commit when given, and on origin/main.
#   2. A new revision is built from backend/ and started with NO traffic,
#      tagged "candidate", with APP_COMMIT set to the commit. No other setting
#      is passed, so none can change.
#   3. Settings are compared: the service before and after the deploy, and
#      the serving revision against the new one. Anything other than the image
#      and APP_COMMIT differing stops the deploy before any visitor sees it.
#   4. Candidate checks at the tagged address: /health, /api/ names this
#      commit, the staff list refuses a request with no sign-in, the route
#      list stays off, and the reference land request of backend/tests answers
#      with this commit's formula. No inquiry is ever sent.
#   5. Traffic moves in steps (10, 50, then 100 percent). Each step is held
#      and watched: the new revision must keep answering /health with this
#      commit, and must log no answer of 500 or more. Any failed step gives all
#      the traffic back to the revision that was serving before.
#   6. The tag is removed and a record for docs/de13-production-setup.md is
#      printed on standard output.
#
# Settings (environment). Names, not secrets; the defaults are production:
#   GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE   see lib.sh
#   DEPLOY_STEPS           traffic steps in percent, default "10 50 100"
#   DEPLOY_GATE_SECONDS    how long each step is watched, default 120
#   DEPLOY_GATE_PROBES     health probes in that time, default 4
#   DEPLOY_LOG_GATE        "on" (default) or "off": also fail a step on any
#                          500-or-more answer the new revision logged
#   DEPLOY_IGNORE_SETTINGS comma-separated setting paths the comparison may
#                          ignore, for a settings change Gbenga agreed to
#
# Exit 0: the new revision serves all traffic (or the dry run finished).
# Exit 1: the new revision was refused or rolled back; the old one serves.
# Exit 2: could not start, or the build failed; no traffic was moved.
# Exit 3: a rollback was needed and did not complete. Act now: see
#         docs/sre/runbooks/bad-deploy.md.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

APPLY=0
EXPECT_COMMIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --commit) [ $# -ge 2 ] || die "--commit needs a commit."; EXPECT_COMMIT="$2"; shift 2 ;;
    --commit=*) EXPECT_COMMIT="${1#--commit=}"; shift ;;
    -h|--help) sed -n '2,42p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: $1. Usage: deploy.sh [--apply] [--commit SHA]" ;;
  esac
done
if [ -n "$EXPECT_COMMIT" ]; then
  EXPECT_COMMIT="$(printf '%s' "$EXPECT_COMMIT" | tr 'A-F' 'a-f')"
  [[ "$EXPECT_COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || die "--commit is not a commit: $EXPECT_COMMIT"
fi

need gcloud node curl git
check_names
STEPS="$(helper steps "${DEPLOY_STEPS:-10 50 100}")"
[ -n "$STEPS" ] || die "DEPLOY_STEPS must be rising whole percentages ending at 100, for example \"10 50 100\"."
GATE_SECONDS="${DEPLOY_GATE_SECONDS:-120}"
GATE_PROBES="${DEPLOY_GATE_PROBES:-4}"
[[ "$GATE_SECONDS" =~ ^[0-9]{1,4}$ ]] || die "DEPLOY_GATE_SECONDS must be a whole number of seconds."
[[ "$GATE_PROBES" =~ ^[1-9][0-9]?$ ]] || die "DEPLOY_GATE_PROBES must be between 1 and 99."
LOG_GATE="${DEPLOY_LOG_GATE:-on}"
[[ "$LOG_GATE" =~ ^(on|off)$ ]] || die "DEPLOY_LOG_GATE must be on or off."
IGNORE="${DEPLOY_IGNORE_SETTINGS:-}"
RETRY_SECONDS="${DEPLOY_RETRY_SECONDS:-5}"
make_work
TRAFFIC_MOVED=0
FINISHED=1
# Whatever ends the script, it must not leave visitors on an unchecked
# revision: if traffic moved and the rollout did not finish, roll back.
on_exit() {
  local code=$?
  if [ "$TRAFFIC_MOVED" = 1 ] && [ "$FINISHED" != 1 ]; then
    FINISHED=1
    say "ERROR: the deploy stopped part-way (exit $code)."
    roll_back || code=3
    [ "$code" = 3 ] || code=1
    print_record "stopped part-way and rolled back to \`$PREV\`." || true
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap on_exit EXIT

# ---------------------------------------------------------------- 1. checkout
REPO="$(cd "$CLOUDRUN_DIR/../../.." && pwd)"
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$REPO is not a git checkout."
COMMIT="$(git -C "$REPO" rev-parse HEAD)"
SHORT="${COMMIT:0:7}"
if [ -n "$EXPECT_COMMIT" ] && [[ "$COMMIT" != "$EXPECT_COMMIT"* ]]; then
  die "The checkout is at $SHORT, not $EXPECT_COMMIT. Check out the commit to deploy first."
fi
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=all)" ] \
  || die "The checkout has uncommitted or untracked files. Deploy only from a clean checkout (git status)."
# gcloud uploads the whole backend folder, git-ignored files included (it has
# no .gcloudignore). A stray .env or key there would be copied to Cloud Build.
STRAY="$(git -C "$REPO" status --porcelain --ignored --untracked-files=all -- backend \
  | grep -vE '(__pycache__/|\.pyc$|\.pytest_cache/)' || true)"
[ -z "$STRAY" ] || die "backend/ holds files git ignores; they would be uploaded with the build. Remove them first: $(printf '%s' "$STRAY" | tr '\n' ' ')"
git -C "$REPO" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null \
  || die "No origin/main in this checkout. Run: git fetch origin main"
git -C "$REPO" merge-base --is-ancestor "$COMMIT" refs/remotes/origin/main \
  || die "$SHORT is not on origin/main. Only merged code is deployed (run git fetch origin main if it was just merged)."
REFERENCE="$REPO/backend/tests/deal_intelligence/candidate_land_equity_first.json"
[ -f "$REFERENCE" ] || die "The reference request is missing: backend/tests/deal_intelligence/candidate_land_equity_first.json"
FORMULA="$(sed -n 's/^FORMULA_VERSION = "\([a-z0-9.-]*\)"$/\1/p' "$REPO/backend/deal_intelligence/engine.py" | head -n 1)"
[ -n "$FORMULA" ] || die "Could not read FORMULA_VERSION from backend/deal_intelligence/engine.py."

# ------------------------------------------------------- 2. what serves today
describe_service "$WORK/before.json"
SERVING="$(helper serving "$WORK/before.json")"
if [ "$(printf '%s\n' "$SERVING" | grep -c .)" != 1 ] || [ "$(printf '%s' "$SERVING" | cut -f2)" != 100 ]; then
  die "The traffic is split ($(printf '%s' "$SERVING" | tr '\t\n' '= ')). Give one revision all of it first (status.sh, rollback.sh)."
fi
PREV="$(printf '%s' "$SERVING" | cut -f1)"
is_revision_name "$PREV" || die "Could not tell which revision serves now."
IFS=$'\t' read -r SERVICE_URL _ _ _ < <(helper service-facts "$WORK/before.json")
describe_revision "$PREV" "$WORK/prev.json"

say "Service $SERVICE in $PROJECT ($REGION)."
say "Serving now: $PREV, 100 percent. Deploying: $SHORT (formula $FORMULA)."
say "Steps: $STEPS percent, each watched for $GATE_SECONDS s with $GATE_PROBES probes; 5xx log gate $LOG_GATE."

DEPLOY_CMD=(gcloud run deploy "$SERVICE" --source "$REPO/backend" --project "$PROJECT" --region "$REGION"
  --no-traffic --tag candidate --update-env-vars "APP_COMMIT=$COMMIT" --quiet)
traffic_cmd() { # STEP NEW -> the command for that step, in TRAFFIC_CMD
  if [ "$1" = 100 ]; then
    # --to-latest, as the hand procedure did: a later settings change (the
    # inquiry switch in "Undo") then reaches visitors without another step.
    TRAFFIC_CMD=(gcloud run services update-traffic "$SERVICE" --to-latest --project "$PROJECT" --region "$REGION")
  else
    TRAFFIC_CMD=(gcloud run services update-traffic "$SERVICE" "--to-revisions=$2=$1,$PREV=$((100 - $1))" --project "$PROJECT" --region "$REGION")
  fi
}
UNTAG_CMD=(gcloud run services update-traffic "$SERVICE" --remove-tags candidate --project "$PROJECT" --region "$REGION")

if [ "$APPLY" != 1 ]; then
  say ""
  say "Dry run. With --apply these commands run, in this order, each step gated:"
  change "${DEPLOY_CMD[@]}"
  for step in $STEPS; do traffic_cmd "$step" NEW_REVISION; change "${TRAFFIC_CMD[@]}"; done
  change "${UNTAG_CMD[@]}"
  say "On any failed check or step: bash scripts/sre/cloudrun/rollback.sh --to $PREV --apply"
  say "Dry run: nothing was changed."
  exit 0
fi

# ------------------------------------------------------------------ the record
DAY="$(utc_date)"
STARTED="$(utc_time)"
SINCE="$(utc_iso)"
RECORD=()
note() { RECORD+=("$*"); say "  $*"; }
print_record() { # RESULT
  printf '### API redeploy from `%s` (%s, %s to %s UTC, deploy.sh)\n\n' "$SHORT" "$DAY" "$STARTED" "$(utc_time)"
  printf -- '- Ran: `deploy.sh --apply`%s, from a clean checkout at `%s` on `main`.\n' \
    "${GITHUB_RUN_ID:+ in GitHub Actions run $GITHUB_RUN_ID}" "$COMMIT"
  printf -- '- Before: `%s` served 100 percent.\n' "$PREV"
  local line
  for line in "${RECORD[@]}"; do printf -- '- %s\n' "$line"; done
  printf -- '- Result: %s\n' "$1"
}

NEW=""
FINISHED=0
# From here on a stop that is not a clean refusal still undoes moved traffic.
die() { refuse "$*"; }

# Give all traffic back to the revision that served before. rollback.sh reads
# the traffic back and asks /health, so its exit code is the truth.
roll_back() {
  say "Rolling back: all traffic to $PREV."
  if bash "$CLOUDRUN_DIR/rollback.sh" --to "$PREV" --apply > "$WORK/rollback.out"; then
    note "Rolled back at $(utc_time): all traffic to \`$PREV\`, which answers /health."
    return 0
  fi
  note "ROLLBACK DID NOT COMPLETE at $(utc_time): $(tail -n 1 "$WORK/rollback.out" 2>/dev/null || true)"
  return 1
}

# Stop: refuse the new revision. Before any traffic moved there is nothing to
# undo; after, the traffic goes back to $PREV.
refuse() {
  local code=1
  FINISHED=1
  say "REFUSED: $*"
  note "Refused: $*"
  if [ "$TRAFFIC_MOVED" = 1 ] && ! roll_back; then code=3; fi
  if [ -n "$NEW" ]; then
    change "${UNTAG_CMD[@]}" >&2 || say "WARNING: could not remove the candidate tag."
  fi
  if [ "$code" = 3 ]; then
    print_record "**rollback did not complete. Follow docs/sre/runbooks/bad-deploy.md now.**"
    say "ACT NOW: the rollback did not complete. Run status.sh, then rollback.sh --to $PREV --apply."
  elif [ "$TRAFFIC_MOVED" = 1 ]; then
    print_record "rolled back. \`$NEW\` keeps 0 percent for diagnosis; \`$PREV\` serves. The service is pinned to \`$PREV\` (release-safety.md, \"After a rollback\")."
  else
    print_record "refused before any traffic moved. \`${NEW:-no revision}\` serves 0 percent; \`$PREV\` serves as before."
  fi
  exit "$code"
}

# An interrupted rollout (Ctrl-C in Cloud Shell, a cancelled workflow) must
# not leave visitors split between two revisions.
on_signal() {
  [ "$FINISHED" = 1 ] && exit 1
  trap - INT TERM
  refuse "the deploy was interrupted"
}
trap on_signal INT TERM

# ------------------------------------------------------------------- 2. build
say ""
say "Building and starting the candidate (no traffic). This takes a few minutes."
if ! change "${DEPLOY_CMD[@]}" >&2; then
  FINISHED=1
  say "ERROR: the deploy command failed. No traffic was moved; $PREV serves."
  exit 2
fi
describe_service "$WORK/after.json"
IFS=$'\t' read -r NEW CANDIDATE_URL < <(helper tagged "$WORK/after.json" candidate)
if ! is_revision_name "$NEW" || [ "$NEW" = "$PREV" ] || [[ ! "$CANDIDATE_URL" =~ ^https:// ]]; then
  NEW=""
  refuse "the deploy did not leave a new revision tagged candidate."
fi
note "Candidate: \`$NEW\` at the tagged address, 0 percent, built at $(utc_time)."
[ "$(helper serving "$WORK/after.json")" = "$(printf '%s\t100' "$PREV")" ] \
  || refuse "after a deploy with --no-traffic, $PREV no longer has all the traffic."
describe_revision "$NEW" "$WORK/new.json"
[ "$(helper ready "$WORK/new.json")" = yes ] || refuse "$NEW is not ready."

# ---------------------------------------------------------------- 3. settings
DRIFT="$(helper settings-diff "$WORK/before.json" "$WORK/after.json" "$IGNORE"
  helper settings-diff "$WORK/prev.json" "$WORK/new.json" "$IGNORE")"
if [ -n "$DRIFT" ]; then
  refuse "settings differ from what serves now (only the image and APP_COMMIT may): $(printf '%s' "$DRIFT" | sort -u | tr '\n' ';' | sed 's/;$//; s/;/; /g')."
fi
note "Settings: the service before and after, and \`$PREV\` against \`$NEW\`, are identical apart from the image and APP_COMMIT."

# -------------------------------------------------------- 4. candidate checks
CHECKED_AT="$(utc_time)"
healthy=0
for _ in 1 2 3; do
  if health_ok "$CANDIDATE_URL"; then healthy=1; break; fi
  sleep "$RETRY_SECONDS" # the first request may wake a sleeping instance
done
[ "$healthy" = 1 ] || refuse "candidate /health answered $HTTP_STATUS, not 200 {\"status\":\"ok\"}."
read_identity "$CANDIDATE_URL" || refuse "candidate /api/ answered $HTTP_STATUS without the service name."
[ "$ID_COMMIT" = "$COMMIT" ] && [ "$ID_REVISION" = "$NEW" ] \
  || refuse "candidate /api/ names revision $ID_REVISION and commit $ID_COMMIT, not $NEW and $COMMIT."
probe GET "$CANDIDATE_URL/api/v1/inquiries/staff"
[[ "$HTTP_STATUS" =~ ^(401|503)$ ]] || refuse "the staff list with no sign-in answered $HTTP_STATUS, not 401 or 503."
STAFF_STATUS="$HTTP_STATUS"
for path in /docs /openapi.json; do
  probe GET "$CANDIDATE_URL$path"
  [ "$HTTP_STATUS" = 404 ] || refuse "$path answered $HTTP_STATUS; the route list must stay off (404)."
done
probe POST "$CANDIDATE_URL/api/v1/deals/analyze" -H 'Content-Type: application/json' --data-binary "@$REFERENCE"
[ "$HTTP_STATUS" = 200 ] || refuse "the reference land request answered $HTTP_STATUS, not 200."
IFS=$'\t' read -r A_FORMULA A_RESIDUAL A_PROFIT A_MARGIN A_IRR < <(helper analysis "$WORK/body")
[ "$A_FORMULA" = "$FORMULA" ] || refuse "the reference land request answered formula $A_FORMULA, not $FORMULA."
[ "$A_RESIDUAL" != - ] && [ "$A_PROFIT" != - ] || refuse "the reference land request answered without its figures."
if [ "$LOG_GATE" = on ]; then
  errors="$(server_errors "$NEW" "$SINCE")" \
    || refuse "could not read the logs of $NEW (needs the Logs Viewer role, or DEPLOY_LOG_GATE=off)."
  [ "$errors" = 0 ] || refuse "$NEW logged $errors answers of 500 or more during its checks."
fi
note "Candidate checks at $CHECKED_AT: /health 200; /api/ names \`$NEW\` and \`$SHORT\`; staff list with no sign-in $STAFF_STATUS; /docs and /openapi.json 404; the reference land request (\`candidate_land_equity_first.json\`) answers formula \`$A_FORMULA\`, residual land value $A_RESIDUAL, development profit $A_PROFIT, margin $A_MARGIN, IRR $A_IRR; no 5xx logged (log gate $LOG_GATE). No inquiry was sent."

# ------------------------------------------------------------ 5. traffic steps
# One watched step: probes spread over the gate time, then the logs.
gate() { # STEP STEP_SINCE
  local interval=$((GATE_SECONDS / GATE_PROBES)) i errors
  for ((i = 1; i <= GATE_PROBES; i++)); do
    sleep "$interval"
    health_ok "$CANDIDATE_URL" || { GATE_PROBLEM="/health answered $HTTP_STATUS at $1 percent"; return 1; }
    read_identity "$CANDIDATE_URL" && [ "$ID_COMMIT" = "$COMMIT" ] \
      || { GATE_PROBLEM="/api/ did not name $SHORT at $1 percent (status $HTTP_STATUS)"; return 1; }
  done
  if [ "$LOG_GATE" = on ]; then
    errors="$(server_errors "$NEW" "$2")" || { GATE_PROBLEM="could not read the logs at $1 percent"; return 1; }
    [ "$errors" = 0 ] || { GATE_PROBLEM="$NEW logged $errors answers of 500 or more at $1 percent"; return 1; }
  fi
  if [ "$1" = 100 ]; then
    # All traffic now: the service's own address must answer from the new revision.
    health_ok "$SERVICE_URL" || { GATE_PROBLEM="the service address answered /health $HTTP_STATUS at 100 percent"; return 1; }
    read_identity "$SERVICE_URL" && [ "$ID_REVISION" = "$NEW" ] \
      || { GATE_PROBLEM="the service address is not answered by $NEW at 100 percent"; return 1; }
  fi
  return 0
}

STEP_NOTES=()
for step in $STEPS; do
  step_since="$(utc_iso)"
  if [ "$step" = 100 ]; then
    describe_service "$WORK/latest.json"
    IFS=$'\t' read -r _ LATEST_CREATED _ _ < <(helper service-facts "$WORK/latest.json")
    # --to-latest would hand the traffic to whatever revision is newest; it
    # must be ours. If someone deployed meanwhile, name ours instead.
    if [ "$LATEST_CREATED" = "$NEW" ]; then traffic_cmd 100 "$NEW"
    else TRAFFIC_CMD=(gcloud run services update-traffic "$SERVICE" "--to-revisions=$NEW=100" --project "$PROJECT" --region "$REGION"); fi
    EXPECTED="$(printf '%s\t100' "$NEW")"
  else
    traffic_cmd "$step" "$NEW"
    EXPECTED="$(printf '%s\t%s\n%s\t%s' "$NEW" "$step" "$PREV" "$((100 - step))" | sort)"
  fi
  say "Step: $step percent to $NEW."
  TRAFFIC_MOVED=1
  change "${TRAFFIC_CMD[@]}" >&2 || refuse "the traffic command for $step percent failed."
  describe_service "$WORK/step.json"
  [ "$(helper serving "$WORK/step.json" | sort)" = "$EXPECTED" ] \
    || refuse "after the $step percent command the traffic is not as asked."
  GATE_PROBLEM=""
  gate "$step" "$step_since" || refuse "step gate failed: $GATE_PROBLEM."
  STEP_NOTES+=("$step percent at $(utc_time)")
done
FINISHED=1
note "Traffic: $(IFS=,; printf '%s' "${STEP_NOTES[*]}" | sed 's/,/, /g'), each step watched for $GATE_SECONDS s with $GATE_PROBES probes and passed. The service address answers from \`$NEW\`."

# -------------------------------------------------------------- 6. tidy, record
if change "${UNTAG_CMD[@]}" >&2; then
  note "Tag \`candidate\` removed: the service is back to one entry, the latest revision at 100 percent."
else
  note "WARNING: the tag \`candidate\` could not be removed; remove it with: $(shown "${UNTAG_CMD[@]}")"
fi
trap - INT TERM
print_record "\`$NEW\` (\`$SHORT\`, formula \`$A_FORMULA\`) serves all traffic. Fallback: \`$PREV\`. Add the row to the table in section 1."
say "Deployed: $NEW serves all traffic."
