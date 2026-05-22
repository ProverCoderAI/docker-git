#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-/tmp/docker-git-e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/browser-command.XXXXXX")"
chmod 0755 "$ROOT"
KEEP="${KEEP:-0}"

E2E_BIN="$ROOT/.e2e-bin"
BROWSER_LOG="$ROOT/browser-command.log"
STATE_PATH="$ROOT/.orch/state/browser-frontend.json"
FAILURE_DUMPED=0
BROWSER_PID=""
BROWSER_STARTUP_ATTEMPTS="${DOCKER_GIT_E2E_BROWSER_STARTUP_ATTEMPTS:-240}"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_PROJECTS_ROOT_VOLUME="docker-git-e2e-browser-$RUN_ID-projects"
export DOCKER_GIT_API_CONTAINER_NAME="docker-git-e2e-browser-$RUN_ID-api"
DOCKER_GIT_API_PORT="$(dg_require_free_port 34000 34999 "browser API")"
export DOCKER_GIT_API_PORT
DOCKER_GIT_WEB_PORT="$(dg_require_free_port 41000 41999 "browser web")"
export DOCKER_GIT_WEB_PORT
export COMPOSE_PROJECT_NAME="docker-git-e2e-browser-$RUN_ID"
export DOCKER_GIT_STATE_AUTO_SYNC=0

fail() {
  echo "e2e/browser-command: $*" >&2
  if [[ "$FAILURE_DUMPED" == "0" ]]; then
    on_error "fail"
  fi
  exit 1
}

browser_alive() {
  [[ -n "$BROWSER_PID" ]] && kill -0 "$BROWSER_PID" 2>/dev/null
}

stop_browser_command() {
  if ! browser_alive; then
    return 0
  fi

  kill -TERM -- "-$BROWSER_PID" 2>/dev/null || kill -TERM "$BROWSER_PID" 2>/dev/null || true
  for _ in $(seq 1 15); do
    if ! browser_alive; then
      break
    fi
    sleep 1
  done
  if browser_alive; then
    kill -KILL -- "-$BROWSER_PID" 2>/dev/null || kill -KILL "$BROWSER_PID" 2>/dev/null || true
  fi
  wait "$BROWSER_PID" 2>/dev/null || true
}

on_error() {
  local line="$1"
  if [[ "$FAILURE_DUMPED" == "1" ]]; then
    return
  fi
  FAILURE_DUMPED=1
  echo "e2e/browser-command: failed at line $line" >&2
  if [[ -f "$BROWSER_LOG" ]]; then
    echo "--- browser command log ---" >&2
    cat "$BROWSER_LOG" >&2 || true
  fi
  if [[ -f "$STATE_PATH" ]]; then
    echo "--- browser runtime state ---" >&2
    cat "$STATE_PATH" >&2 || true
  fi
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$DOCKER_GIT_API_CONTAINER_NAME" 2>/dev/null; then
    docker logs "$DOCKER_GIT_API_CONTAINER_NAME" --tail 200 || true
  fi
  (cd "$REPO_ROOT" && docker compose ps) || true
  (cd "$REPO_ROOT" && docker compose logs --no-color --tail 200) || true
}

cleanup() {
  stop_browser_command
  (cd "$REPO_ROOT" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/browser-command: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/browser-command: controller container: $DOCKER_GIT_API_CONTAINER_NAME" >&2
    return
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

wait_for_log_line() {
  local needle="$1"
  local attempts="${2:-90}"

  for _ in $(seq 1 "$attempts"); do
    if [[ -f "$BROWSER_LOG" ]] && grep -Fq -- "$needle" "$BROWSER_LOG"; then
      return 0
    fi
    if ! browser_alive; then
      fail "browser command exited before log line appeared: $needle"
    fi
    sleep 2
  done

  fail "timed out waiting for log line: $needle"
}

wait_for_http_contains() {
  local url="$1"
  local needle="$2"
  local attempts="${3:-90}"
  local body=""

  for _ in $(seq 1 "$attempts"); do
    if body="$(curl -fsS --connect-timeout 2 --max-time 5 "$url" 2>/dev/null)" \
      && grep -Fq -- "$needle" <<<"$body"; then
      return 0
    fi
    if ! browser_alive; then
      fail "browser command exited before endpoint became ready: $url"
    fi
    sleep 2
  done

  fail "timed out waiting for endpoint: $url"
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v curl >/dev/null 2>&1 || fail "missing 'curl' command"
command -v setsid >/dev/null 2>&1 || fail "missing 'setsid' command"

mkdir -p "$E2E_BIN"
dg_ensure_docker "$E2E_BIN"
dg_prepare_docker_git_cli "$REPO_ROOT" "$E2E_BIN"

cd "$REPO_ROOT"
setsid bash -lc 'bun run docker-git -- browser' >"$BROWSER_LOG" 2>&1 &
BROWSER_PID="$!"

wait_for_log_line "Ensuring docker-git API controller is current."
wait_for_http_contains "http://127.0.0.1:${DOCKER_GIT_API_PORT}/health" '"ok":true' "$BROWSER_STARTUP_ATTEMPTS"
wait_for_http_contains "http://127.0.0.1:${DOCKER_GIT_WEB_PORT}/" "<title>docker-git browser</title>" "$BROWSER_STARTUP_ATTEMPTS"
wait_for_http_contains "http://127.0.0.1:${DOCKER_GIT_WEB_PORT}/api/health" '"ok":true' "$BROWSER_STARTUP_ATTEMPTS"
wait_for_log_line "docker-git web runtime listening on http://"

browser_alive || fail "browser command exited after startup checks"
docker ps --format '{{.Names}}' | grep -qx "$DOCKER_GIT_API_CONTAINER_NAME" \
  || fail "expected controller container to be running: $DOCKER_GIT_API_CONTAINER_NAME"
[[ -f "$STATE_PATH" ]] || fail "expected browser runtime state file: $STATE_PATH"

grep -Fq -- "\"port\": \"$DOCKER_GIT_WEB_PORT\"" "$STATE_PATH" \
  || fail "expected runtime state to record web port $DOCKER_GIT_WEB_PORT"
grep -Fq -- "\"apiBaseUrl\": \"http://127.0.0.1:$DOCKER_GIT_API_PORT\"" "$STATE_PATH" \
  || fail "expected runtime state to record API base URL http://127.0.0.1:$DOCKER_GIT_API_PORT"

echo "e2e/browser-command: bun run docker-git -- browser startup verified" >&2
