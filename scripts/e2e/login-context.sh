#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/login-context.XXXXXX")"
# docker-git containers may `chown -R` the `.docker-git` bind mount to UID 1000.
# `mktemp -d` creates 0700 dirs; if ownership changes, the host runner may lose access.
chmod 0755 "$ROOT"
KEEP="${KEEP:-0}"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0

ACTIVE_OUT_DIR=""
ACTIVE_CONTAINER=""
ACTIVE_SERVICE=""

fail() {
  echo "e2e/login-context: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/login-context: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if [[ -n "$ACTIVE_OUT_DIR" ]] && [[ -f "$ACTIVE_OUT_DIR/docker-compose.yml" ]]; then
    (cd "$ACTIVE_OUT_DIR" && docker compose ps) || true
    (cd "$ACTIVE_OUT_DIR" && docker compose logs --no-color --tail 200) || true
  fi
}

cleanup_active_case() {
  if [[ -n "$ACTIVE_OUT_DIR" ]] && [[ -f "$ACTIVE_OUT_DIR/docker-compose.yml" ]]; then
    (cd "$ACTIVE_OUT_DIR" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
  fi
  ACTIVE_OUT_DIR=""
  ACTIVE_CONTAINER=""
  ACTIVE_SERVICE=""
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/login-context: KEEP=1 set; preserving temp dir: $ROOT" >&2
    if [[ -n "$ACTIVE_CONTAINER" ]]; then
      echo "e2e/login-context: active container: $ACTIVE_CONTAINER" >&2
    fi
    if [[ -n "$ACTIVE_OUT_DIR" ]]; then
      echo "e2e/login-context: active out dir: $ACTIVE_OUT_DIR" >&2
    fi
    return
  fi
  cleanup_active_case
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v ssh >/dev/null 2>&1 || fail "missing 'ssh' command"
command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"
command -v ssh-keygen >/dev/null 2>&1 || fail "missing 'ssh-keygen' command"

ssh-keygen -q -t ed25519 -N "" -f "$ROOT/dev_ssh_key" >/dev/null
cp "$ROOT/dev_ssh_key.pub" "$ROOT/authorized_keys"
chmod 0600 "$ROOT/dev_ssh_key"
chmod 0644 "$ROOT/authorized_keys"

wait_for_ssh() {
  local ssh_port="$1"
  local attempts=30
  local attempt=1

  while [[ "$attempt" -le "$attempts" ]]; do
    if timeout 1 bash -lc "cat < /dev/null > /dev/tcp/127.0.0.1/$ssh_port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt="$((attempt + 1))"
  done

  return 1
}

run_case() {
  local case_name="$1"
  local repo_url="$2"
  local expected_context_line="$3"
  local out_dir_rel=".docker-git/e2e/login-context-${case_name}-${RUN_ID}"
  local out_dir="$ROOT/e2e/login-context-${case_name}-${RUN_ID}"
  local container_name="dg-e2e-login-${case_name}-${RUN_ID}"
  local service_name="dg-e2e-login-${case_name}-${RUN_ID}"
  local volume_name="dg-e2e-login-${case_name}-${RUN_ID}-home"
  local ssh_port="$(( (RANDOM % 1000) + 21000 ))"
  local login_log="$ROOT/login-${case_name}.log"

  mkdir -p "$out_dir/.orch/env"
  cat > "$out_dir/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
EOF_ENV

  ACTIVE_OUT_DIR="$out_dir"
  ACTIVE_CONTAINER="$container_name"
  ACTIVE_SERVICE="$service_name"

  (
    cd "$REPO_ROOT"
    pnpm run docker-git clone "$repo_url" \
      --force \
      --no-ssh \
      --authorized-keys "$ROOT/authorized_keys" \
      --ssh-port "$ssh_port" \
      --out-dir "$out_dir_rel" \
      --container-name "$container_name" \
      --service-name "$service_name" \
      --volume-name "$volume_name"
  )

  wait_for_ssh "$ssh_port" || fail "ssh port did not open for $case_name (port: $ssh_port)"

  set +e
  timeout 30s bash -lc "printf 'exit\n' | ssh -i \"$ROOT/dev_ssh_key\" -tt -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p \"$ssh_port\" dev@localhost" > "$login_log" 2>&1
  local ssh_exit=$?
  set -e

  if [[ "$ssh_exit" -ne 0 ]]; then
    cat "$login_log" >&2 || true
    fail "ssh login failed for $case_name (exit: $ssh_exit)"
  fi

  grep -Fq -- "$expected_context_line" "$login_log" \
    || fail "expected context line not found for $case_name: $expected_context_line"

  grep -Fq -- "Старые сессии можно запустить с помощью codex resume" "$login_log" \
    || fail "expected codex resume hint for $case_name"

  cleanup_active_case
}

run_case \
  "issue" \
  "https://github.com/octocat/Hello-World/issues/1" \
  "Контекст workspace: issue #1 (https://github.com/octocat/Hello-World/issues/1)"

run_case \
  "pr" \
  "https://github.com/octocat/Hello-World/pull/1" \
  "Контекст workspace: PR #1 (https://github.com/octocat/Hello-World/pull/1)"
