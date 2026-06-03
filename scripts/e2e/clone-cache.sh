#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/clone-cache.XXXXXX")"
# docker-git containers may `chown -R` the `.docker-git` bind mount to UID 1000.
# Keep host-side e2e workspace writable for cleanup and assertions.
chmod 0777 "$ROOT"
mkdir -p "$ROOT/e2e"
chmod 0777 "$ROOT/e2e"
KEEP="${KEEP:-0}"
# Cold controller and project image builds can be slow on GitHub-hosted runners,
# but the clone command should still fail before the workflow-level timeout.
CLONE_COMMAND_TIMEOUT="${DOCKER_GIT_E2E_CLONE_CACHE_TIMEOUT:-1800s}"
FAILURE_DUMPED=0

dg_ensure_docker "$ROOT/.e2e-bin"
dg_prepare_docker_git_cli "$REPO_ROOT" "$ROOT/.e2e-bin"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_PULL=0
export DOCKER_GIT_STATE_AUTO_SYNC=0

REPO_URL="https://github.com/octocat/Hello-World/tree/master"
TARGET_DIR="/home/dev/workspaces/octocat/hello-world"
MIRROR_PREFIX="/home/dev/.docker-git/.cache/git-mirrors"

ACTIVE_OUT_DIR=""
ACTIVE_CONTAINER=""
ACTIVE_CLONE_LOG=""

fail() {
  echo "e2e/clone-cache: $*" >&2
  if [[ "$FAILURE_DUMPED" == "0" ]]; then
    on_error "fail"
  fi
  exit 1
}

reset_shared_clone_cache_volume() {
  dg_project_docker volume create docker-git-shared-cache >/dev/null
  dg_project_docker run --rm \
    -v docker-git-shared-cache:/target \
    alpine:3.20 \
    sh -euc 'mkdir -p /target && find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
}

on_error() {
  local line="$1"
  if [[ "$FAILURE_DUMPED" == "1" ]]; then
    return
  fi
  FAILURE_DUMPED=1
  echo "e2e/clone-cache: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if [[ -n "$ACTIVE_CONTAINER" ]]; then
    dg_project_docker logs "$ACTIVE_CONTAINER" --tail 200 || true
  fi
  if [[ -n "$ACTIVE_CLONE_LOG" ]] && [[ -f "$ACTIVE_CLONE_LOG" ]]; then
    echo "--- host clone log ---" >&2
    cat "$ACTIVE_CLONE_LOG" >&2 || true
  fi
  if [[ -n "$ACTIVE_OUT_DIR" ]]; then
    dg_project_compose "$ACTIVE_OUT_DIR" ps || true
    dg_project_compose "$ACTIVE_OUT_DIR" logs --no-color --tail 200 || true
  fi
}

cleanup_active_case() {
  if [[ -n "$ACTIVE_OUT_DIR" ]]; then
    dg_project_compose "$ACTIVE_OUT_DIR" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  ACTIVE_OUT_DIR=""
  ACTIVE_CONTAINER=""
  ACTIVE_CLONE_LOG=""
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/clone-cache: KEEP=1 set; preserving temp dir: $ROOT" >&2
    return
  fi
  cleanup_active_case
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"

wait_for_clone_completion() {
  local container="$1"
  local attempts=120
  local attempt=1

  while [[ "$attempt" -le "$attempts" ]]; do
    if dg_project_docker exec "$container" test -f /run/docker-git/clone.done >/dev/null 2>&1; then
      return 0
    fi

    if dg_project_docker exec "$container" test -f /run/docker-git/clone.failed >/dev/null 2>&1; then
      dg_project_docker logs "$container" >&2 || true
      fail "clone failed marker found for container: $container"
    fi

    sleep 1
    attempt="$((attempt + 1))"
  done

  dg_project_docker logs "$container" >&2 || true
  fail "clone did not complete in time for container: $container"
}

run_clone_case() {
  local case_name="$1"
  local expect_cache_use="$2"
  local expected_mirror_name="${3:-}"
  local out_dir_rel=".docker-git/e2e/clone-cache-${case_name}-${RUN_ID}"
  local out_dir="$ROOT/e2e/clone-cache-${case_name}-${RUN_ID}"
  local container_name="dg-e2e-cache-${case_name}-${RUN_ID}"
  local service_name="dg-e2e-cache-${case_name}-${RUN_ID}"
  local volume_name="dg-e2e-cache-${case_name}-${RUN_ID}-home"
  local ssh_port
  ssh_port="$(dg_pick_free_port 22000 22999)"
  local log_path="$ROOT/clone-cache-${case_name}.log"
  local host_log_path="$ROOT/clone-cache-${case_name}-host.log"

  mkdir -p "$out_dir/.orch/env"
  chmod 0777 "$out_dir" "$out_dir/.orch" "$out_dir/.orch/env"
  cat > "$out_dir/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
EOF_ENV

  ACTIVE_OUT_DIR="$out_dir"
  ACTIVE_CONTAINER="$container_name"
  ACTIVE_CLONE_LOG="$host_log_path"

  set +e
  (
    cd "$REPO_ROOT"
    timeout "$CLONE_COMMAND_TIMEOUT" bun packages/app/dist/src/docker-git/main.js clone "$REPO_URL" \
      --force \
      --gh-skip \
      --no-ssh \
      --authorized-keys "$ROOT/authorized_keys" \
      --ssh-port "$ssh_port" \
      --out-dir "$out_dir_rel" \
      --container-name "$container_name" \
      --service-name "$service_name" \
      --volume-name "$volume_name"
  ) >"$host_log_path" 2>&1
  local clone_exit=$?
  set -e
  if [[ "$clone_exit" -eq 124 ]]; then
    fail "clone command timed out after $CLONE_COMMAND_TIMEOUT for case: $case_name"
  fi
  if [[ "$clone_exit" -ne 0 ]]; then
    fail "clone command failed with exit code $clone_exit for case: $case_name"
  fi

  wait_for_clone_completion "$container_name"
  dg_project_docker logs "$container_name" > "$log_path" 2>&1 || true

  dg_project_docker exec -u dev "$container_name" bash -lc "test -d '$TARGET_DIR/.git'" \
    || fail "expected cloned repo at: $TARGET_DIR"

  local branch
  branch="$(dg_project_docker exec -u dev "$container_name" bash -lc "cd '$TARGET_DIR' && git rev-parse --abbrev-ref HEAD")"
  [[ "$branch" == "master" ]] || fail "expected branch master, got: $branch"

  if [[ "$expect_cache_use" == "1" ]]; then
    if [[ -n "$expected_mirror_name" ]]; then
      grep -Fq -- "[clone-cache] using mirror: $MIRROR_PREFIX/$expected_mirror_name" "$log_path" \
        || fail "expected cache reuse log for mirror $expected_mirror_name in second clone"
    else
      grep -Fq -- "[clone-cache] using mirror: $MIRROR_PREFIX/" "$log_path" \
        || fail "expected cache reuse log in second clone"
    fi
    grep -Fq -- "[clone-cache] pulled branch: master" "$log_path" \
      || fail "expected branch pull from warm cache in second clone"
  else
    grep -Fq -- "[clone-cache] mirror created: $MIRROR_PREFIX/" "$log_path" \
      || grep -Fq -- "[clone-cache] using mirror: $MIRROR_PREFIX/" "$log_path" \
      || fail "expected cache bootstrap or warm-cache reuse log in first clone"
  fi

  cleanup_active_case
}

mkdir -p "$ROOT/.orch/auth/codex" "$ROOT/.orch/env"
: > "$ROOT/authorized_keys"

dg_run_docker_git "$REPO_ROOT" status >/dev/null
reset_shared_clone_cache_volume

run_clone_case "first" "0"

FIRST_LOG="$ROOT/clone-cache-first.log"
mirror_line="$(
  {
    grep -F -- "[clone-cache] mirror created: $MIRROR_PREFIX/" "$FIRST_LOG" || true
    grep -F -- "[clone-cache] using mirror: $MIRROR_PREFIX/" "$FIRST_LOG" || true
  } | tail -n 1
)"
[[ -n "$mirror_line" ]] || fail "expected mirror log line in first clone logs: $FIRST_LOG"
mirror_path="${mirror_line#*mirror created: }"
mirror_path="${mirror_path#*using mirror: }"
[[ -n "$mirror_path" ]] || fail "failed to parse mirror path from first clone log line: $mirror_line"
MIRROR_NAME="$(basename "$mirror_path")"
[[ -n "$MIRROR_NAME" ]] || fail "failed to parse mirror name from mirror path: $mirror_path"

run_clone_case "second" "1" "$MIRROR_NAME"

echo "e2e/clone-cache: cache reuse verified for $REPO_URL"
