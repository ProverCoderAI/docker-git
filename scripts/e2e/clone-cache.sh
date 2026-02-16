#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/clone-cache.XXXXXX")"
# docker-git containers may `chown -R` the `.docker-git` bind mount to UID 1000.
# Keep host-side e2e workspace writable for cleanup and assertions.
chmod 0777 "$ROOT"
mkdir -p "$ROOT/e2e"
chmod 0777 "$ROOT/e2e"
KEEP="${KEEP:-0}"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0

REPO_URL="https://github.com/octocat/Hello-World/issues/1"
TARGET_DIR="/home/dev/octocat/hello-world/issue-1"
MIRROR_PREFIX="/home/dev/.docker-git/.cache/git-mirrors"

ACTIVE_OUT_DIR=""
ACTIVE_CONTAINER=""

fail() {
  echo "e2e/clone-cache: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/clone-cache: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if [[ -n "$ACTIVE_CONTAINER" ]]; then
    docker logs "$ACTIVE_CONTAINER" --tail 200 || true
  fi
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

wait_for_clone_completion() {
  local container="$1"
  local attempts=120
  local attempt=1

  while [[ "$attempt" -le "$attempts" ]]; do
    if docker exec "$container" test -f /run/docker-git/clone.done >/dev/null 2>&1; then
      return 0
    fi

    if docker exec "$container" test -f /run/docker-git/clone.failed >/dev/null 2>&1; then
      docker logs "$container" >&2 || true
      fail "clone failed marker found for container: $container"
    fi

    sleep 1
    attempt="$((attempt + 1))"
  done

  docker logs "$container" >&2 || true
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
  local ssh_port="$(( (RANDOM % 1000) + 22000 ))"
  local log_path="$ROOT/clone-cache-${case_name}.log"

  mkdir -p "$out_dir/.orch/env"
  chmod 0777 "$out_dir" "$out_dir/.orch" "$out_dir/.orch/env"
  cat > "$out_dir/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
EOF_ENV

  ACTIVE_OUT_DIR="$out_dir"
  ACTIVE_CONTAINER="$container_name"

  (
    cd "$REPO_ROOT"
    pnpm run docker-git clone "$REPO_URL" \
      --force \
      --no-ssh \
      --authorized-keys "$ROOT/authorized_keys" \
      --ssh-port "$ssh_port" \
      --out-dir "$out_dir_rel" \
      --container-name "$container_name" \
      --service-name "$service_name" \
      --volume-name "$volume_name"
  )

  wait_for_clone_completion "$container_name"
  docker logs "$container_name" > "$log_path" 2>&1 || true

  docker exec -u dev "$container_name" bash -lc "test -d '$TARGET_DIR/.git'" \
    || fail "expected cloned repo at: $TARGET_DIR"

  local branch
  branch="$(docker exec -u dev "$container_name" bash -lc "cd '$TARGET_DIR' && git rev-parse --abbrev-ref HEAD")"
  [[ "$branch" == "issue-1" ]] || fail "expected branch issue-1, got: $branch"

  if [[ "$expect_cache_use" == "1" ]]; then
    if [[ -n "$expected_mirror_name" ]]; then
      grep -Fq -- "[clone-cache] using mirror: $MIRROR_PREFIX/$expected_mirror_name" "$log_path" \
        || fail "expected cache reuse log for mirror $expected_mirror_name in second clone"
    else
      grep -Fq -- "[clone-cache] using mirror: $MIRROR_PREFIX/" "$log_path" \
        || fail "expected cache reuse log in second clone"
    fi
  else
    grep -Fq -- "[clone-cache] mirror created: $MIRROR_PREFIX/" "$log_path" \
      || fail "expected cache bootstrap log in first clone"
  fi

  cleanup_active_case
}

mkdir -p "$ROOT/.orch/auth/codex" "$ROOT/.orch/env"
: > "$ROOT/authorized_keys"

run_clone_case "first" "0"

MIRROR_ROOT="$ROOT/.cache/git-mirrors"
[[ -d "$MIRROR_ROOT" ]] || fail "expected mirror root directory to exist: $MIRROR_ROOT"

mapfile -t MIRRORS < <(find "$MIRROR_ROOT" -mindepth 1 -maxdepth 1 -type d -name "*.git" | sort)
[[ "${#MIRRORS[@]}" -eq 1 ]] || fail "expected exactly one mirror directory, got: ${#MIRRORS[@]}"

CACHE_HOST_DIR="${MIRRORS[0]}"
MIRROR_NAME="$(basename "$CACHE_HOST_DIR")"

run_clone_case "second" "1" "$MIRROR_NAME"

echo "e2e/clone-cache: cache reuse verified for $REPO_URL"
