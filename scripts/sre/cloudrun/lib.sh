# shellcheck shell=bash
# Shared by status.sh, rollback.sh and deploy.sh. Source it; do not run it.
#
# Which service: read from the environment, with production as the default
# (docs/de13-production-setup.md). These are names, not secrets. The scripts
# hold no credential: they use whatever `gcloud` is signed in as (Gbenga's
# Cloud Shell, or the workflow's short-lived sign-in).
#
#   GCP_PROJECT_ID     default diamondecho-prod
#   GCP_REGION         default us-east1
#   CLOUD_RUN_SERVICE  default diamondecho-api

CLOUDRUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${GCP_PROJECT_ID:-diamondecho-prod}"
REGION="${GCP_REGION:-us-east1}"
SERVICE="${CLOUD_RUN_SERVICE:-diamondecho-api}"
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-20}"
USER_AGENT="DiamondEcho-SRE-Deploy/1 (+https://github.com/Ggeorge73/DiamondEcho)"

# Progress goes to the error stream, so the standard output holds only the
# result (JSON, or the record to paste).
say() { printf '%s\n' "$*" >&2; }

# Exit 2: the command could not do its job and changed nothing.
die() { say "ERROR: $*"; exit 2; }

need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH."
  done
}

# The names end up inside commands, so they must look like names.
check_names() {
  [[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "GCP_PROJECT_ID is not a project ID: $PROJECT"
  [[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]+$ ]] || die "GCP_REGION is not a region: $REGION"
  [[ "$SERVICE" =~ ^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$ ]] || die "CLOUD_RUN_SERVICE is not a service name: $SERVICE"
}

is_revision_name() { [[ "$1" =~ ^[a-z][a-z0-9-]{0,62}$ ]]; }

# A scratch folder for the service descriptions. They hold the environment
# variable values, so they are never written into the repository and the
# folder is removed when the script ends.
make_work() {
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/sre-cloudrun.XXXXXX")"
  chmod 700 "$WORK"
}

helper() { node "$CLOUDRUN_DIR/lib.mjs" "$@"; }

# Read-only questions to Cloud Run. Always with the project and the region:
# Cloud Shell's default project can be staging or production.
describe_service() {
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format json > "$1" \
    || die "Could not read the service $SERVICE in $PROJECT ($REGION). Is gcloud signed in, with the Cloud Run Viewer role or more?"
}
list_revisions() {
  gcloud run revisions list --service "$SERVICE" --project "$PROJECT" --region "$REGION" --format json > "$1" \
    || die "Could not list the revisions of $SERVICE in $PROJECT ($REGION)."
}
describe_revision() {
  gcloud run revisions describe "$1" --project "$PROJECT" --region "$REGION" --format json > "$2" \
    || die "Could not read the revision $1."
}

# A command as it would be typed, for the dry run and the record.
shown() {
  local out="" part
  for part in "$@"; do
    if [[ "$part" =~ ^[A-Za-z0-9_./:=,@%+-]+$ ]]; then out+="$part "; else out+="'${part//\'/\'\\\'\'}' "; fi
  done
  printf '%s' "${out% }"
}

# Every command that changes Cloud Run goes through here, so that without
# --apply nothing can change by accident.
change() {
  say "  \$ $(shown "$@")"
  if [ "${APPLY:-0}" = 1 ]; then
    "$@"
  else
    say "    (dry run: not run)"
  fi
}

# One request. Sets HTTP_STATUS ("000" when there was no answer) and leaves
# the body in $WORK/body and the headers in $WORK/headers. Never stops the
# script: a failed request is a result to judge, not an error.
#   probe METHOD URL [more curl arguments]
probe() {
  local method="$1" url="$2"
  shift 2
  : > "$WORK/body"
  : > "$WORK/headers"
  HTTP_STATUS="$(curl -sS --max-time "$PROBE_TIMEOUT_SECONDS" -A "$USER_AGENT" -X "$method" \
    -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "$@" "$url" 2>"$WORK/curl-error")" || HTTP_STATUS="000"
  [[ "$HTTP_STATUS" =~ ^[0-9]{3}$ ]] || HTTP_STATUS="000"
}

# GET /health answered 200 {"status":"ok"}.
health_ok() {
  probe GET "$1/health"
  [ "$HTTP_STATUS" = 200 ] && [ "$(helper health "$WORK/body")" = ok ]
}

# GET /api/: sets ID_SERVICE, ID_REVISION and ID_COMMIT ("-" when absent).
read_identity() {
  ID_SERVICE="-"; ID_REVISION="-"; ID_COMMIT="-"
  probe GET "$1/api/"
  [ "$HTTP_STATUS" = 200 ] || return 1
  IFS=$'\t' read -r ID_SERVICE ID_REVISION ID_COMMIT < <(helper identity "$WORK/body")
  [ "$ID_SERVICE" = "DiamondEcho API" ]
}

# The clock. SRE_NOW (an ISO time) replaces it in tests and drills
# (scripts/sre/README.md); production runs never set it.
clock() {
  if [ -n "${SRE_NOW:-}" ]; then date -u -d "$SRE_NOW" "$@"; else date -u "$@"; fi
}
utc_time() { clock +%H:%M:%S; }
utc_date() { clock +%Y-%m-%d; }
utc_iso() { clock +%Y-%m-%dT%H:%M:%SZ; }

# How many answers of 500 or more a revision logged since a time. Prints the
# number; fails when the logs cannot be read (the caller decides what that
# means). Reads only the status codes, never a request or its address.
#   server_errors REVISION SINCE_ISO
server_errors() {
  local filter
  filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""
  filter+=" AND resource.labels.revision_name=\"$1\" AND httpRequest.status>=500 AND timestamp>=\"$2\""
  gcloud logging read "$filter" --project "$PROJECT" --limit 50 --format 'value(httpRequest.status)' > "$WORK/errors" 2>"$WORK/errors-stderr" || return 1
  grep -c '[0-9]' "$WORK/errors" || true
}
