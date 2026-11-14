#!/usr/bin/env bash
# Opens and saves the monitor's state: the orphan `sre-status` branch, which
# only the SRE workflows write and which is never merged into main.
#
#   bash scripts/sre/state-git.sh checkout DIR
#       Clone the branch into DIR (a new or empty folder). If the branch does
#       not exist yet, DIR starts as an empty branch of that name.
#   bash scripts/sre/state-git.sh commit DIR "message"
#       Commit everything in DIR and push it. If another workflow pushed in
#       the meantime, rebase on top of its work and try again, so neither run
#       loses the other's writes (details below).
#
# DIR is its own clone with a real .git folder, so nothing here can touch the
# checkout of main the workflow runs from. The only ref ever pushed is
# refs/heads/sre-status. Commits are made as github-actions[bot].
#
# Settings (environment):
#   GITHUB_TOKEN        used for fetch and push to https://github.com, passed
#                       to git through the environment, never on a command
#                       line and never printed. Without it git uses whatever
#                       credentials it already has.
#   SRE_STATE_REMOTE    where the branch lives; default: the origin of the
#                       repository this is run from. The tests point it at a
#                       local bare repository.
#   SRE_STATUS_BRANCH   default sre-status. main and master are refused.
#   SRE_STATE_RETRY_SLEEP  seconds between push attempts (default 2; tests use 0).
#   SRE_STATE_AUTH_PREFIX  tests only: the address the token is sent to when
#                       the remote is not https://github.com (a local server).
#
# Two writers at once. The workflows share one concurrency group, so this is
# the exception, but a push can still lose a race. Then:
#   *.jsonl files (history, deploys, remediation log) only ever have lines
#   added, so both sides' lines are kept (git's built-in "union" merge).
#   Any other file in conflict (status.json, incidents.json, uptime, slo.json)
#   is a whole snapshot: the run being saved is the newer one, so its copy is
#   kept, and the file names are printed so the loss of the other run's
#   snapshot (not of its history) is visible in the log.
#
# Exit codes: 0 done (or nothing to save); 2 failed, with the reason printed.

set -euo pipefail

BRANCH="${SRE_STATUS_BRANCH:-sre-status}"
ATTEMPTS=5
SLEEP="${SRE_STATE_RETRY_SLEEP:-2}"
BOT_NAME="github-actions[bot]"
BOT_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
# Set through the environment too, which wins over any user.name setting.
export GIT_AUTHOR_NAME="$BOT_NAME" GIT_AUTHOR_EMAIL="$BOT_EMAIL"
export GIT_COMMITTER_NAME="$BOT_NAME" GIT_COMMITTER_EMAIL="$BOT_EMAIL"

fail() { echo "state-git: $*" >&2; exit 2; }
say() { echo "state-git: $*"; }

case "$BRANCH" in
  main|master|HEAD|"") fail "refusing to use branch '$BRANCH': the state lives only on its own branch" ;;
esac
git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || fail "'$BRANCH' is not a valid branch name"

# Run a git command that talks to the remote. The token goes to git through
# GIT_CONFIG_* variables, which are not shown in the process list or the log.
# A checkout made by actions/checkout may still hold its own stored header for
# github.com; git would then send two Authorization headers, which GitHub may
# refuse. An empty value first clears any stored one, then ours is added.
net() {
  local prefix=""
  if [[ "$REMOTE" == https://github.com/* ]]; then prefix="https://github.com/"; else prefix="${SRE_STATE_AUTH_PREFIX:-}"; fi
  if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "$prefix" ]; then
    local auth
    auth="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
    GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=2 \
      GIT_CONFIG_KEY_0="http.${prefix}.extraheader" GIT_CONFIG_VALUE_0="" \
      GIT_CONFIG_KEY_1="http.${prefix}.extraheader" GIT_CONFIG_VALUE_1="AUTHORIZATION: basic $auth" \
      git "$@"
  else
    GIT_TERMINAL_PROMPT=0 git "$@"
  fi
}

checkout() {
  local dir="$1"
  REMOTE="${SRE_STATE_REMOTE:-$(git config --get remote.origin.url 2>/dev/null || true)}"
  [ -n "$REMOTE" ] || fail "no remote: run this inside the repository or set SRE_STATE_REMOTE"
  if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    fail "$dir is not empty; give a new folder"
  fi

  # Ask first whether the branch exists, so that a network failure is never
  # mistaken for "no branch yet" (which would start the state from nothing).
  local found=0
  net ls-remote --exit-code --heads "$REMOTE" "refs/heads/$BRANCH" >/dev/null 2>&1 || found=$?
  if [ "$found" -ne 0 ] && [ "$found" -ne 2 ]; then
    fail "could not reach the remote to look for $BRANCH (git exit $found)"
  fi

  mkdir -p "$dir"
  git init -q "$dir"
  git -C "$dir" remote add origin "$REMOTE"
  # Append-only files merge by keeping both sides' lines.
  mkdir -p "$dir/.git/info"
  printf '*.jsonl merge=union\n' > "$dir/.git/info/attributes"

  if [ "$found" -eq 0 ]; then
    # 50 commits of depth is plenty to find where a racing push forked.
    net -C "$dir" fetch -q --depth=50 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" \
      || fail "could not fetch $BRANCH"
    git -C "$dir" checkout -q -B "$BRANCH" "refs/remotes/origin/$BRANCH"
    say "checked out $BRANCH into $dir"
  else
    git -C "$dir" symbolic-ref HEAD "refs/heads/$BRANCH"
    say "$BRANCH does not exist yet; $dir starts empty and the first save creates it"
  fi
}

# Settle a rebase that stopped on conflicts: keep the replayed (newer) side.
settle_rebase() {
  local dir="$1" guard=0
  while [ -d "$dir/.git/rebase-merge" ] || [ -d "$dir/.git/rebase-apply" ]; do
    guard=$((guard + 1))
    [ "$guard" -le 20 ] || { git -C "$dir" rebase --abort >/dev/null 2>&1 || true; return 1; }
    local files
    files="$(git -C "$dir" diff --name-only --diff-filter=U)"
    if [ -n "$files" ]; then
      while IFS= read -r file; do
        [ -n "$file" ] || continue
        # During a rebase, stage 3 ("theirs") is the commit being replayed:
        # this run's copy.
        if git -C "$dir" cat-file -e ":3:$file" 2>/dev/null; then
          git -C "$dir" checkout -q --theirs -- "$file"
          git -C "$dir" add -- "$file"
        else
          git -C "$dir" rm -q -- "$file"
        fi
        say "both runs changed $file; kept this run's newer copy"
      done <<< "$files"
    fi
    GIT_EDITOR=true git -C "$dir" -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" \
      rebase --continue >/dev/null 2>&1 || true
  done
}

commit() {
  local dir="$1" message="$2"
  [ -d "$dir/.git" ] || fail "$dir is not a checkout made by 'state-git.sh checkout'"
  REMOTE="$(git -C "$dir" config --get remote.origin.url)" || fail "$dir has no origin"
  local head
  head="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || true)"
  [ "$head" = "$BRANCH" ] || fail "$dir is on '$head', not $BRANCH"
  [ -n "$message" ] || fail "a commit message is required"

  git -C "$dir" add -A
  if git -C "$dir" rev-parse -q --verify HEAD >/dev/null && git -C "$dir" diff --cached --quiet; then
    say "nothing changed; nothing to save"
    return 0
  fi
  git -C "$dir" -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit -q --allow-empty -m "$message"

  local attempt
  for attempt in $(seq 1 "$ATTEMPTS"); do
    if net -C "$dir" push -q origin "HEAD:refs/heads/$BRANCH" 2>/dev/null; then
      say "saved to $BRANCH (attempt $attempt)"
      return 0
    fi
    [ "$attempt" -lt "$ATTEMPTS" ] || break
    say "push $attempt was refused (another run saved first); rebasing on its work"
    sleep "$(( SLEEP * attempt ))"
    net -C "$dir" fetch -q --depth=50 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" \
      || { say "fetch failed; will retry"; continue; }
    git -C "$dir" -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" \
      rebase -q "refs/remotes/origin/$BRANCH" >/dev/null 2>&1 || true
    settle_rebase "$dir" || fail "could not combine this run's state with the other run's"
  done
  fail "could not save to $BRANCH after $ATTEMPTS attempts"
}

case "${1:-}" in
  checkout) [ $# -eq 2 ] || fail "usage: state-git.sh checkout DIR"; checkout "$2" ;;
  commit) [ $# -eq 3 ] || fail "usage: state-git.sh commit DIR \"message\""; commit "$2" "$3" ;;
  *) fail "usage: state-git.sh checkout DIR | commit DIR \"message\"" ;;
esac
