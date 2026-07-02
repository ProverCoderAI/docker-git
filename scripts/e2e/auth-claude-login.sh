#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"

ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-/tmp/docker-git-e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/auth-claude-login.XXXXXX")"
chmod 0700 "$ROOT"
KEEP="${KEEP:-0}"
COMPOSE_OVERRIDE_FILE="$ROOT/docker-compose.auth-claude-login.yml"
DOCKER_WRAPPER_DIR="$ROOT/docker-wrapper"
DOCKER_WRAPPER_FILE="$DOCKER_WRAPPER_DIR/docker"
LOGIN_TIMEOUT_SECONDS="${DOCKER_GIT_E2E_AUTH_CLAUDE_LOGIN_TIMEOUT_SECONDS:-900}"
OAUTH_TOKEN_MARKER="sk-ant-oat01-docker-git-e2e-oauth-token-marker"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0
export DOCKER_GIT_API_CONTAINER_NAME="docker-git-e2e-auth-claude-$RUN_ID-api"
export DOCKER_GIT_PROJECTS_ROOT_VOLUME="docker-git-e2e-auth-claude-$RUN_ID-projects"
export DOCKER_GIT_CONTROLLER_COMPOSE_EXTRA_FILE="$COMPOSE_OVERRIDE_FILE"
export COMPOSE_PROJECT_NAME="docker-git"

mkdir -p "$DOCKER_WRAPPER_DIR"
cat > "$DOCKER_WRAPPER_FILE" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

REAL_DOCKER="/usr/bin/docker"
CLAUDE_AUTH_IMAGE="docker-git-auth-claude:latest"
args=("$@")
image_index=-1

for index in "${!args[@]}"; do
  if [[ "${args[$index]}" == "$CLAUDE_AUTH_IMAGE" ]]; then
    image_index="$index"
  fi
done

if [[ "$image_index" -ge 0 ]]; then
  first_command_arg="${args[$((image_index + 1))]:-}"
  second_command_arg="${args[$((image_index + 2))]:-}"

  if [[ "$first_command_arg" == "setup-token" ]]; then
    : "${DOCKER_GIT_E2E_CLAUDE_SETUP_TOKEN_MARKER:?missing synthetic Claude OAuth token marker}"
    cat <<TOKEN
Welcome to Claude Code

 ✓ Long-lived authentication token created successfully!

 Your OAuth token (valid for 1 year):

 ${DOCKER_GIT_E2E_CLAUDE_SETUP_TOKEN_MARKER}

 Store this token securely. You won't be able to see it again.
TOKEN
    exit 0
  fi

  if [[ "$first_command_arg" == "-p" && "$second_command_arg" == "ping" ]]; then
    echo "synthetic Claude API probe failure" >&2
    exit 7
  fi
fi

exec "$REAL_DOCKER" "$@"
BASH
chmod 0755 "$DOCKER_WRAPPER_FILE"

cat > "$COMPOSE_OVERRIDE_FILE" <<YAML
services:
  api:
    environment:
      DOCKER_GIT_E2E_CLAUDE_SETUP_TOKEN_MARKER: ${OAUTH_TOKEN_MARKER}
    volumes:
      - ${DOCKER_WRAPPER_FILE}:/usr/local/bin/docker:ro
YAML

LOG_FILE="/tmp/docker-git-auth-claude-login-$RUN_ID.log"
STATUS_LOG_FILE="/tmp/docker-git-auth-claude-status-$RUN_ID.log"

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
    echo "e2e/auth-claude-login: status log file: $STATUS_LOG_FILE" >&2
    return
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE" >/dev/null 2>&1 || true
  rm -f "$STATUS_LOG_FILE" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"

dg_ensure_docker "$ROOT/.e2e-bin"
dg_prepare_docker_git_cli "$REPO_ROOT" "$ROOT/.e2e-bin"

set +e
timeout "${LOGIN_TIMEOUT_SECONDS}s" bash -lc 'cd "$1" && bun packages/app/dist/src/docker-git/main.js auth claude login --web' bash "$REPO_ROOT" \
  >"$LOG_FILE" 2>&1
login_exit=$?
set -e

if [[ "$login_exit" -ne 0 ]]; then
  cat "$LOG_FILE" >&2 || true
  fail "docker-git auth claude login --web failed (exit: $login_exit)"
fi

if grep -Fq -- "$OAUTH_TOKEN_MARKER" "$LOG_FILE"; then
  fail "expected OAuth token marker to be absent from auth claude login output"
fi

grep -Fq -- "Claude OAuth token saved" "$LOG_FILE" \
  || fail "expected saved-token warning in auth claude login output"

grep -Fq -- "live Claude API access is not yet verified" "$LOG_FILE" \
  || fail "expected diagnostic API probe warning in auth claude login output"

docker exec "$DOCKER_GIT_API_CONTAINER_NAME" \
  test -s "$ROOT/.orch/auth/claude/default/.oauth-token" \
  || fail "expected persisted Claude OAuth token in controller state"

set +e
timeout "${LOGIN_TIMEOUT_SECONDS}s" bash -lc 'cd "$1" && bun packages/app/dist/src/docker-git/main.js auth claude status' bash "$REPO_ROOT" \
  >"$STATUS_LOG_FILE" 2>&1
status_exit=$?
set -e

if [[ "$status_exit" -ne 0 ]]; then
  cat "$STATUS_LOG_FILE" >&2 || true
  fail "docker-git auth claude status failed (exit: $status_exit)"
fi

if grep -Fq -- "$OAUTH_TOKEN_MARKER" "$STATUS_LOG_FILE"; then
  fail "expected OAuth token marker to be absent from auth claude status output"
fi

grep -Fq -- "Claude connected (default, oauth-token" "$STATUS_LOG_FILE" \
  || fail "expected connected OAuth status after auth claude login --web"

echo "e2e/auth-claude-login: docker-backed Claude login --web and status warning path verified" >&2
