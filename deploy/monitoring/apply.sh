#!/usr/bin/env bash
# Puts the monitoring definitions in deploy/monitoring/ into Google Cloud.
#
#   PROJECT_ID=diamondecho-prod NOTIFICATION_CHANNEL=projects/diamondecho-prod/notificationChannels/123 \
#     bash deploy/monitoring/apply.sh            # print the plan; change nothing
#   ... bash deploy/monitoring/apply.sh --apply  # Gbenga only, from Cloud Shell
#
# What it handles, in this order (each folder is a set of REST resource bodies;
# ${PROJECT_ID} and ${NOTIFICATION_CHANNEL} in them are filled in here):
#   log-metrics/      Cloud Logging log-based metrics, matched by "name"
#   uptime-checks/    Cloud Monitoring uptime checks, matched by "displayName"
#   alert-policies/   alert policies, matched by "displayName"
#   dashboards/       dashboards, matched by "displayName"
#   slos/             service.json is a custom service (matched by
#                     "displayName"); every other file is one SLO of that
#                     service, matched by userLabels.sli (or displayName), so
#                     renaming an SLO when its target is accepted updates it.
#
# Without --apply it changes nothing. If gcloud is signed in it reads the
# project (list and describe only) to say "create" or "update"; if not, it
# says "create or update". With --apply it creates what is missing and
# replaces what exists with the file's version. It never deletes anything:
# a definition removed from the repository is left in the project for a
# person to remove.
#
# Settings (environment):
#   PROJECT_ID            required, for example diamondecho-prod
#   NOTIFICATION_CHANNEL  required when there are alert policies: the full
#                         name of the email channel, from
#                         gcloud beta monitoring channels list --project "$PROJECT_ID" --format='value(name,displayName)'
#   SRE_MONITORING_DIR    another folder of definitions (the tests use it)
#
# Exit codes: 0 done; 2 refused or failed, with the reason printed.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${SRE_MONITORING_DIR:-$HERE}"
API="https://monitoring.googleapis.com/v3"
APPLY=0

fail() { echo "apply.sh: $*" >&2; exit 2; }

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) fail "unknown option $arg (only --apply)" ;;
  esac
done

# Changing Google Cloud is Gbenga's step, by hand. A workflow never does it.
if [ "$APPLY" = 1 ] && [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  fail "--apply is refused inside GitHub Actions: Gbenga runs it from Cloud Shell"
fi

PROJECT_ID="${PROJECT_ID:-}"
NOTIFICATION_CHANNEL="${NOTIFICATION_CHANNEL:-}"
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail "set PROJECT_ID to the project id, for example diamondecho-prod"
if [ -n "$NOTIFICATION_CHANNEL" ] && ! [[ "$NOTIFICATION_CHANNEL" =~ ^projects/[a-z0-9-]+/notificationChannels/[0-9]+$ ]]; then
  fail "NOTIFICATION_CHANNEL must look like projects/PROJECT/notificationChannels/NUMBER"
fi
command -v gcloud >/dev/null || fail "gcloud is needed (Cloud Shell has it)"
command -v python3 >/dev/null || fail "python3 is needed (Cloud Shell has it)"
[ -d "$DIR" ] || fail "no definitions folder at $DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Fill in the placeholders and check the result is JSON with nothing left
# unfilled. Prints the path of the filled-in copy.
render() {
  local file="$1" out
  out="$WORK/$(basename "$(dirname "$file")")-$(basename "$file")"
  PROJECT_ID="$PROJECT_ID" NOTIFICATION_CHANNEL="$NOTIFICATION_CHANNEL" python3 - "$file" "$out" <<'PY' || exit 2
import json, os, re, sys
source, target = sys.argv[1], sys.argv[2]
text = open(source, encoding="utf-8").read()
for name in ("PROJECT_ID", "NOTIFICATION_CHANNEL"):
    if "${%s}" % name in text:
        if not os.environ.get(name):
            sys.exit(f"apply.sh: {source} needs {name}; set it and run again")
        text = text.replace("${%s}" % name, os.environ[name])
left = re.findall(r"\$\{[A-Za-z_]+\}", text)
if left:
    sys.exit(f"apply.sh: {source} has placeholders this script does not fill: {', '.join(sorted(set(left)))}")
try:
    json.loads(text)
except ValueError as error:
    sys.exit(f"apply.sh: {source} is not valid JSON ({error})")
open(target, "w", encoding="utf-8").write(text)
PY
  echo "$out"
}

# A field of a JSON file: field FILE displayName | name | sli
field() {
  python3 - "$1" "$2" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
key = sys.argv[2]
value = (doc.get("userLabels") or {}).get("sli") if key == "sli" else doc.get(key)
print(value or "")
PY
}

# From a REST list answer on stdin, the resource whose displayName (or
# userLabels.sli) matches. Prints its name, nothing when absent; fails when
# two match, because then "which one to update" is a person's call.
# (The program is passed with -c: a heredoc would take the place of the
# list arriving on stdin.)
PICK='
import json, sys
items_key, key, wanted = sys.argv[1], sys.argv[2], sys.argv[3]
raw = sys.stdin.read().strip() or "{}"
items = json.loads(raw).get(items_key, [])
def value(item):
    return (item.get("userLabels") or {}).get("sli") if key == "sli" else item.get(key)
found = [item["name"] for item in items if value(item) == wanted]
if len(found) > 1:
    sys.exit(f"apply.sh: {len(found)} resources match {wanted!r}; remove the extra one by hand first")
print(found[0] if found else "")
'
pick() { python3 -c "$PICK" "$1" "$2" "$3"; }

# Can we look? Reading needs a signed-in gcloud; planning does not.
READ=0
if [ -n "$(gcloud config get-value account 2>/dev/null || true)" ]; then READ=1; fi
if [ "$APPLY" = 1 ] && [ "$READ" = 0 ]; then fail "gcloud is not signed in (gcloud auth login)"; fi

TOKEN=""
token() {
  if [ -z "$TOKEN" ]; then TOKEN="$(gcloud auth print-access-token 2>/dev/null)" || fail "could not get an access token from gcloud"; fi
}
# A REST call. The token goes to curl on stdin (-H @-), never on the command
# line and never into the output.
rest() {
  local method="$1" url="$2" body="${3:-}"
  token
  command -v curl >/dev/null || fail "curl is needed"
  local args=(-sS --fail-with-body -X "$method" -H "Content-Type: application/json" -H @- "$url")
  if [ -n "$body" ]; then args+=(--data-binary "@$body"); fi
  printf 'Authorization: Bearer %s\n' "$TOKEN" | curl "${args[@]}"
}

CHANGES=0
plan() { printf '  %-14s %-8s %s\n' "$1" "$2" "$3"; }
act() {
  # act KIND VERB LABEL COMMAND...
  local kind="$1" verb="$2" label="$3"; shift 3
  plan "$kind" "$verb" "$label"
  CHANGES=$((CHANGES + 1))
  if [ "$APPLY" = 1 ]; then "$@" >/dev/null || fail "$verb of $kind \"$label\" failed"; fi
}
unknown() { plan "$1" "create or update" "$2 (not signed in to gcloud, so not looked up)"; CHANGES=$((CHANGES + 1)); }

files() { find "$DIR/$1" -maxdepth 1 -name '*.json' -type f 2>/dev/null | LC_ALL=C sort; }

echo "Project: $PROJECT_ID"
if [ "$APPLY" = 1 ]; then echo "Mode: APPLY (changes Google Cloud)"; else echo "Mode: plan only (nothing is changed)"; fi
echo

# ---------------------------------------------------------------- log metrics
for file in $(files log-metrics); do
  rendered="$(render "$file")"
  name="$(field "$rendered" name)"
  [[ "$name" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "$file needs a simple \"name\""
  if [ "$READ" = 0 ]; then unknown log-metric "$name"; continue; fi
  if gcloud logging metrics describe "$name" --project "$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
    act log-metric update "$name" gcloud logging metrics update "$name" --project "$PROJECT_ID" --config-from-file="$rendered" --quiet
  else
    act log-metric create "$name" gcloud logging metrics create "$name" --project "$PROJECT_ID" --config-from-file="$rendered" --quiet
  fi
done

# -------------------------------------------------------------- uptime checks
for file in $(files uptime-checks); do
  rendered="$(render "$file")"
  label="$(field "$rendered" displayName)"
  [ -n "$label" ] || fail "$file has no displayName"
  if [ "$READ" = 0 ]; then unknown uptime-check "$label"; continue; fi
  existing="$(rest GET "$API/projects/$PROJECT_ID/uptimeCheckConfigs?pageSize=100" | pick uptimeCheckConfigs displayName "$label")" || exit 2
  if [ -n "$existing" ]; then
    act uptime-check update "$label" rest PATCH "$API/$existing" "$rendered"
  else
    act uptime-check create "$label" rest POST "$API/projects/$PROJECT_ID/uptimeCheckConfigs" "$rendered"
  fi
done

# -------------------------------------------------------------- alert policies
for file in $(files alert-policies); do
  rendered="$(render "$file")"
  label="$(field "$rendered" displayName)"
  [ -n "$label" ] || fail "$file has no displayName"
  if [ "$READ" = 0 ]; then unknown alert-policy "$label"; continue; fi
  existing="$(gcloud monitoring policies list --project "$PROJECT_ID" --filter="displayName=\"$label\"" --format='value(name)')"
  [ "$(printf '%s' "$existing" | grep -c .)" -le 1 ] || fail "more than one alert policy is named \"$label\"; remove the extra one by hand first"
  if [ -n "$existing" ]; then
    act alert-policy update "$label" gcloud monitoring policies update "$existing" --project "$PROJECT_ID" --policy-from-file="$rendered" --quiet
  else
    act alert-policy create "$label" gcloud monitoring policies create --project "$PROJECT_ID" --policy-from-file="$rendered" --quiet
  fi
done

# ------------------------------------------------------------------ dashboards
for file in $(files dashboards); do
  rendered="$(render "$file")"
  label="$(field "$rendered" displayName)"
  [ -n "$label" ] || fail "$file has no displayName"
  if [ "$READ" = 0 ]; then unknown dashboard "$label"; continue; fi
  existing="$(gcloud monitoring dashboards list --project "$PROJECT_ID" --filter="displayName=\"$label\"" --format='value(name)')"
  [ "$(printf '%s' "$existing" | grep -c .)" -le 1 ] || fail "more than one dashboard is named \"$label\"; remove the extra one by hand first"
  if [ -n "$existing" ]; then
    act dashboard update "$label" gcloud monitoring dashboards update "$existing" --project "$PROJECT_ID" --config-from-file="$rendered" --quiet
  else
    act dashboard create "$label" gcloud monitoring dashboards create --project "$PROJECT_ID" --config-from-file="$rendered" --quiet
  fi
done

# ------------------------------------------------------------------------ SLOs
if [ -f "$DIR/slos/service.json" ]; then
  rendered="$(render "$DIR/slos/service.json")"
  label="$(field "$rendered" displayName)"
  service=""
  if [ "$READ" = 0 ]; then
    unknown service "$label"
  else
    service="$(rest GET "$API/projects/$PROJECT_ID/services?pageSize=100" | pick services displayName "$label")" || exit 2
    if [ -n "$service" ]; then
      act service update "$label" rest PATCH "$API/$service" "$rendered"
    else
      plan service create "$label"
      CHANGES=$((CHANGES + 1))
      if [ "$APPLY" = 1 ]; then
        service="$(rest POST "$API/projects/$PROJECT_ID/services" "$rendered" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')" \
          || fail "create of service \"$label\" failed"
      fi
    fi
  fi
  for file in $(files slos); do
    [ "$(basename "$file")" = service.json ] && continue
    rendered="$(render "$file")"
    label="$(field "$rendered" displayName)"
    # "sli" here means userLabels.sli (see field and pick), never a top-level field.
    key=sli; match="$(field "$rendered" sli)"
    if [ -z "$match" ]; then key=displayName; match="$label"; fi
    if [ "$READ" = 0 ]; then unknown slo "$label"; continue; fi
    existing=""
    if [ -n "$service" ]; then
      existing="$(rest GET "$API/$service/serviceLevelObjectives?pageSize=100" | pick serviceLevelObjectives "$key" "$match")" || exit 2
    fi
    if [ -n "$existing" ]; then
      act slo update "$label" rest PATCH "$API/$existing" "$rendered"
    else
      plan slo create "$label"
      CHANGES=$((CHANGES + 1))
      if [ "$APPLY" = 1 ]; then rest POST "$API/$service/serviceLevelObjectives" "$rendered" >/dev/null || fail "create of SLO \"$label\" failed"; fi
    fi
  done
fi

echo
if [ "$APPLY" = 1 ]; then
  echo "Done: $CHANGES resources created or updated in $PROJECT_ID. Nothing was deleted."
else
  echo "Plan only: $CHANGES resources would be created or updated. Nothing was changed."
  echo "To apply (Gbenga, from Cloud Shell): PROJECT_ID=$PROJECT_ID NOTIFICATION_CHANNEL=<channel name> bash deploy/monitoring/apply.sh --apply"
fi
