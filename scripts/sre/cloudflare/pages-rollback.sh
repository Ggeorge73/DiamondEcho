#!/usr/bin/env bash
# Put the previous good build of the public site back on diamondecho.com.
# Cloudflare Pages keeps every build; a rollback makes an earlier one the live
# one again in seconds. Nothing is rebuilt and no setting changes.
#
#   bash scripts/sre/cloudflare/pages-rollback.sh [--apply] [--to DEPLOYMENT_ID]
#                                                 [--expect-live-commit SHA]
#
# Without --apply it only reads, and says which build it would put back.
# --to names the build to put back; without it, the newest successful
# production build older than the live one and made from another commit.
# --expect-live-commit refuses unless the live build is from that commit, so
# an automatic rollback after a bad merge cannot undo a newer, good build.
#
# Needs, from the environment (GitHub secrets; this repository creates none):
#   CLOUDFLARE_API_TOKEN   a token with "Cloudflare Pages: Edit" on the account
#   CLOUDFLARE_ACCOUNT_ID  the account that holds the project
#   PAGES_PROJECT          default diamondecho (the public site)
# Without them it stops and changes nothing. The token is passed to curl in a
# file only this script can read, never on a command line, and never printed.
#
# The last line of standard output is one JSON object:
#   {"action":"pages-rollback","applied":false,"project":"…","from":{…},"to":{…},"verified":null}
# Exit 0: done, or dry run. Exit 1: asked, but Cloudflare does not show the
# build as live afterwards. Exit 2: refused, not configured, or failed.
# After a rollback the next merge to main deploys as usual and replaces it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="https://api.cloudflare.com/client/v4"
PROJECT="${PAGES_PROJECT:-diamondecho}"
say() { printf '%s\n' "$*" >&2; }
die() { say "ERROR: $*"; exit 2; }
helper() { node "$HERE/lib.mjs" "$@"; }

APPLY=0
WANTED=""
EXPECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --to) [ $# -ge 2 ] || die "--to needs a deployment ID."; WANTED="$2"; shift 2 ;;
    --expect-live-commit) [ $# -ge 2 ] || die "--expect-live-commit needs a commit."; EXPECT="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
[ -z "$WANTED" ] || [[ "$WANTED" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "--to is not a deployment ID."
EXPECT="$(printf '%s' "$EXPECT" | tr 'A-F' 'a-f')"
[ -z "$EXPECT" ] || [[ "$EXPECT" =~ ^[0-9a-f]{7,40}$ ]] || die "--expect-live-commit is not a commit."
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9-]{0,57}$ ]] || die "PAGES_PROJECT is not a project name."
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  die "Not set up: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed (docs/sre/needs-from-gbenga.md). Roll back in the dashboard instead: docs/sre/release-safety.md."
fi
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || die "CLOUDFLARE_ACCOUNT_ID is not an account ID."
command -v curl >/dev/null 2>&1 || die "curl is not installed."
command -v node >/dev/null 2>&1 || die "node is not installed."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sre-pages.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
( umask 077; printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN" > "$WORK/auth" )
BASE="$API/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT"

call() { # METHOD URL OUTFILE -> sets HTTP_STATUS
  HTTP_STATUS="$(curl -sS --max-time 30 -X "$1" -H "@$WORK/auth" -H 'Content-Type: application/json' \
    -o "$3" -w '%{http_code}' "$2" 2>"$WORK/curl-error")" || HTTP_STATUS="000"
  [[ "$HTTP_STATUS" =~ ^[0-9]{3}$ ]] || HTTP_STATUS="000"
}
need_ok() { # FILE WHAT
  [ "$HTTP_STATUS" = 200 ] && [ "$(helper ok "$1")" = yes ] \
    || die "Cloudflare refused $2 (HTTP $HTTP_STATUS): $(helper errors "$1")"
}

call GET "$BASE" "$WORK/project.json"
need_ok "$WORK/project.json" "to read the project $PROJECT"
IFS=$'\t' read -r LIVE_ID LIVE_COMMIT LIVE_CREATED < <(helper live "$WORK/project.json"; printf '\n')
[ -n "${LIVE_ID:-}" ] || die "Could not tell which build of $PROJECT is live."
if [ -n "$EXPECT" ] && [[ "$LIVE_COMMIT" != "$EXPECT"* ]]; then
  die "Refused: the live build is from ${LIVE_COMMIT}, not ${EXPECT}. Rolling back now would undo a different build."
fi

call GET "$BASE/deployments?env=production&per_page=25" "$WORK/list.json"
need_ok "$WORK/list.json" "to list the builds of $PROJECT"
IFS=$'\t' read -r TO_ID TO_COMMIT TO_CREATED < <(helper choose "$WORK/list.json" "$LIVE_ID" "$LIVE_COMMIT" "$LIVE_CREATED" "$WANTED"; printf '\n')
[ -n "${TO_ID:-}" ] || die "No earlier successful production build${WANTED:+ named $WANTED} to put back."

result() { # applied verified
  printf '{"action":"pages-rollback","applied":%s,"project":%s,"from":{"id":"%s","commit":"%s"},"to":{"id":"%s","commit":"%s"},"verified":%s}\n' \
    "$1" "$(helper json-string "$PROJECT")" "$LIVE_ID" "${LIVE_COMMIT#-}" "$TO_ID" "${TO_COMMIT#-}" "$2"
}
say "Pages project $PROJECT. Live: build $LIVE_ID (commit ${LIVE_COMMIT}, $LIVE_CREATED)."
say "Rollback: build $TO_ID (commit ${TO_COMMIT}, $TO_CREATED)."
if [ "$APPLY" != 1 ]; then
  say "  POST $BASE/deployments/$TO_ID/rollback"
  say "Dry run: nothing was changed. Add --apply to do it."
  result false null
  exit 0
fi

call POST "$BASE/deployments/$TO_ID/rollback" "$WORK/rollback.json"
need_ok "$WORK/rollback.json" "the rollback"
# Read it back: the live build is what the project says now.
call GET "$BASE" "$WORK/after.json"
need_ok "$WORK/after.json" "to read the project after the rollback"
IFS=$'\t' read -r NOW_ID _ _ < <(helper live "$WORK/after.json"; printf '\n')
if [ "${NOW_ID:-}" != "$TO_ID" ]; then
  say "WARNING: Cloudflare accepted the rollback but shows build ${NOW_ID:-none} as live."
  result true false
  exit 1
fi
say "Rolled back: build $TO_ID (commit ${TO_COMMIT}) is live on $PROJECT."
result true true
