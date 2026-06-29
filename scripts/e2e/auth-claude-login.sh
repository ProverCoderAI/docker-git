#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"

ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-/tmp/docker-git-e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/auth-claude-login.XXXXXX")"
chmod 0777 "$ROOT"
KEEP="${KEEP:-0}"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0
export DOCKER_GIT_API_CONTAINER_NAME="docker-git-e2e-auth-claude-$RUN_ID-api"
export DOCKER_GIT_PROJECTS_ROOT_VOLUME="docker-git-e2e-auth-claude-$RUN_ID-projects"
export COMPOSE_PROJECT_NAME="docker-git-e2e-auth-claude-$RUN_ID"
export DOCKER_GIT_CLAUDE_OAUTH_TOKEN="${DOCKER_GIT_CLAUDE_OAUTH_TOKEN:-sk-ant-oat01-DOCKER-GIT-E2E-FAKE-TOKEN-000000000000}"

LOG_FILE="/tmp/docker-git-auth-claude-login-$RUN_ID.log"

fail() {
  echo "e2e/auth-claude-login: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/auth-claude-login: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  docker logs "$DOCKER_GIT_API_CONTAINER_NAME" --tail 200 || true
  (cd "$REPO_ROOT" && docker compose ps) || true
  (cd "$REPO_ROOT" && docker compose logs --no-color --tail 200) || true
}

cleanup() {
  (cd "$REPO_ROOT" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/auth-claude-login: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/auth-claude-login: log file: $LOG_FILE" >&2
    return
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"

dg_ensure_docker "$ROOT/.e2e-bin"
dg_prepare_docker_git_cli "$REPO_ROOT" "$ROOT/.e2e-bin"

set +e
timeout 180s bash -lc 'cd "$1" && bun packages/app/dist/src/docker-git/main.js auth claude login' bash "$REPO_ROOT" \
  >"$LOG_FILE" 2>&1
login_exit=$?
set -e

if [[ "$login_exit" -ne 0 ]]; then
  cat "$LOG_FILE" >&2 || true
  fail "docker-git auth claude login failed (exit: $login_exit)"
fi

grep -Fq -- "Claude OAuth token saved" "$LOG_FILE" \
  || fail "expected saved-token warning in auth claude login output"

grep -Fq -- "live Claude API access is not yet verified" "$LOG_FILE" \
  || fail "expected diagnostic API probe warning in auth claude login output"

docker exec "$DOCKER_GIT_API_CONTAINER_NAME" \
  test -s "$ROOT/.orch/auth/claude/default/.oauth-token" \
  || fail "expected persisted Claude OAuth token in controller state"

echo "e2e/auth-claude-login: docker-backed Claude login warning path verified" >&2
