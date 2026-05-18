#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/clone-auto-open-ssh.XXXXXX")"
chmod 0777 "$ROOT"
mkdir -p "$ROOT/e2e"
chmod 0777 "$ROOT/e2e"
KEEP="${KEEP:-0}"

E2E_BIN="$ROOT/.e2e-bin"
mkdir -p "$E2E_BIN"
dg_ensure_docker "$E2E_BIN"
dg_prepare_docker_git_cli "$REPO_ROOT" "$E2E_BIN"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0

REPO_URL="https://github.com/octocat/Hello-World/issues/1"
TARGET_DIR="/home/dev/workspaces/octocat/hello-world/issue-1"
OUT_DIR_REL=".docker-git/e2e/clone-auto-open-ssh-$RUN_ID"
OUT_DIR="$ROOT/e2e/clone-auto-open-ssh-$RUN_ID"
CONTAINER_NAME="dg-e2e-clone-auto-ssh-$RUN_ID"
SERVICE_NAME="dg-e2e-clone-auto-ssh-$RUN_ID"
VOLUME_NAME="dg-e2e-clone-auto-ssh-$RUN_ID-home"
SSH_PORT="$(dg_pick_free_port 24000 24999)"
SSH_KEY="$ROOT/dev_ssh_key"
SSH_PUB_KEY="$ROOT/dev_ssh_key.pub"
CLONE_LOG="$ROOT/clone-auto-open-ssh.log"
SSH_INVOCATION_LOG="$ROOT/ssh-invocation.log"
SSH_SESSION_LOG="$ROOT/ssh-session.log"
RUN_SCRIPT="$ROOT/run-clone-auto-open-ssh.sh"
# Cold controller and project image builds can be slow on GitHub-hosted runners,
# especially when Ubuntu/NodeSource package mirrors are cold.
CLONE_AUTO_OPEN_TIMEOUT="${DOCKER_GIT_E2E_CLONE_AUTO_OPEN_TIMEOUT:-1800s}"
FAILURE_DUMPED=0

fail() {
  echo "e2e/clone-auto-open-ssh: $*" >&2
  if [[ "$FAILURE_DUMPED" == "0" ]]; then
    on_error "fail"
  fi
  exit 1
}

on_error() {
  local line="$1"
  if [[ "$FAILURE_DUMPED" == "1" ]]; then
    return
  fi
  FAILURE_DUMPED=1
  echo "e2e/clone-auto-open-ssh: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if dg_project_docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" 2>/dev/null; then
    dg_project_docker inspect "$CONTAINER_NAME" || true
    dg_project_docker logs "$CONTAINER_NAME" --tail 200 || true
  fi
  if [[ -f "$CLONE_LOG" ]]; then
    echo "--- clone log ---" >&2
    cat "$CLONE_LOG" >&2 || true
  fi
  if [[ -f "$SSH_INVOCATION_LOG" ]]; then
    echo "--- ssh invocation log ---" >&2
    cat "$SSH_INVOCATION_LOG" >&2 || true
  fi
  if [[ -f "$SSH_SESSION_LOG" ]]; then
    echo "--- ssh session log ---" >&2
    cat "$SSH_SESSION_LOG" >&2 || true
  fi
  if [[ -d "$OUT_DIR" ]]; then
    dg_project_compose "$OUT_DIR" ps || true
    dg_project_compose "$OUT_DIR" logs --no-color --tail 200 || true
  fi
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/clone-auto-open-ssh: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/clone-auto-open-ssh: container name: $CONTAINER_NAME" >&2
    echo "e2e/clone-auto-open-ssh: out dir: $OUT_DIR" >&2
    return
  fi
  if [[ -d "$OUT_DIR" ]]; then
    dg_project_compose "$OUT_DIR" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  dg_project_docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  dg_project_docker volume rm \
    "$VOLUME_NAME" \
    "${VOLUME_NAME}-bootstrap" \
    "${SERVICE_NAME}_${VOLUME_NAME}" \
    "${SERVICE_NAME}_${VOLUME_NAME}-bootstrap" \
    >/dev/null 2>&1 || true
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v script >/dev/null 2>&1 || fail "missing 'script' command (util-linux)"
command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"
command -v ssh-keygen >/dev/null 2>&1 || fail "missing 'ssh-keygen' command"
REAL_SSH="$(command -v ssh)" || fail "missing 'ssh' command"

ssh-keygen -q -t ed25519 -N "" -C "docker-git-e2e-auto-open" -f "$SSH_KEY" >/dev/null
cp "$SSH_PUB_KEY" "$ROOT/authorized_keys"
chmod 0600 "$SSH_KEY" || true
chmod 0644 "$ROOT/authorized_keys" || true
dg_write_docker_host_file "$SSH_KEY" 600 < "$SSH_KEY"
dg_write_docker_host_file "$SSH_PUB_KEY" 644 < "$SSH_PUB_KEY"
dg_write_docker_host_file "$ROOT/authorized_keys" 644 < "$SSH_PUB_KEY"

mkdir -p "$OUT_DIR/.orch/env"
chmod 0777 "$OUT_DIR" "$OUT_DIR/.orch" "$OUT_DIR/.orch/env"
dg_write_docker_host_file "$OUT_DIR/authorized_keys" 644 < "$SSH_PUB_KEY"
cat > "$OUT_DIR/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
EOF_ENV

cat > "$E2E_BIN/ssh" <<'EOF_SSH'
#!/usr/bin/env bash
set -euo pipefail

: "${DOCKER_GIT_E2E_REAL_SSH:?}"
: "${DOCKER_GIT_E2E_SSH_INVOCATION_LOG:?}"
: "${DOCKER_GIT_E2E_SSH_SESSION_LOG:?}"

REMOTE_COMMAND="bash -lic 'codex --version >/dev/null && exit'"

{
  printf "argv:"
  for arg in "$@"; do
    printf " <%s>" "$arg"
  done
  printf "\n"
} >> "$DOCKER_GIT_E2E_SSH_INVOCATION_LOG"

run_ssh() {
  "$DOCKER_GIT_E2E_REAL_SSH" "$@" "$REMOTE_COMMAND" \
    >> "$DOCKER_GIT_E2E_SSH_SESSION_LOG" 2>&1
}

container_ip() {
  if [[ -z "${DOCKER_GIT_E2E_CONTAINER_NAME:-}" ]]; then
    return 1
  fi

  source "$REPO_ROOT/scripts/e2e/_lib.sh"
  dg_project_container_ip "$DOCKER_GIT_E2E_CONTAINER_NAME"
}

run_ssh_via_container_ip() {
  local ip
  ip="$(container_ip)"
  if [[ -z "$ip" ]]; then
    return 255
  fi

  local rewritten=()
  local replace_port=0
  local arg
  for arg in "$@"; do
    if [[ "$replace_port" == "1" ]]; then
      rewritten+=("22")
      replace_port=0
      continue
    fi

    case "$arg" in
      -p)
        rewritten+=("-p")
        replace_port=1
        ;;
      *@127.0.0.1|*@localhost)
        rewritten+=("${arg%@*}@$ip")
        ;;
      *)
        rewritten+=("$arg")
        ;;
    esac
  done

  printf "fallback-target: <%s>\n" "$ip" >> "$DOCKER_GIT_E2E_SSH_INVOCATION_LOG"
  source "$REPO_ROOT/scripts/e2e/_lib.sh"
  dg_project_ssh_to_container "$DOCKER_GIT_E2E_CONTAINER_NAME" "$DOCKER_GIT_E2E_REAL_SSH" \
    "${rewritten[@]}" "$REMOTE_COMMAND" \
    >> "$DOCKER_GIT_E2E_SSH_SESSION_LOG" 2>&1
}

set +e
run_ssh "$@"
exit_code=$?
if [[ "$exit_code" -eq 255 ]]; then
  run_ssh_via_container_ip "$@"
  exit_code=$?
fi
set -e

printf "exit: %s\n" "$exit_code" >> "$DOCKER_GIT_E2E_SSH_INVOCATION_LOG"
exit "$exit_code"
EOF_SSH
chmod +x "$E2E_BIN/ssh"

cat > "$RUN_SCRIPT" <<'EOF_RUN'
#!/usr/bin/env bash
set -euo pipefail

cd "$REPO_ROOT"
bun packages/app/dist/src/docker-git/main.js clone "$REPO_URL" \
  --force \
  --gh-skip \
  --authorized-keys "$ROOT/authorized_keys" \
  --ssh-port "$SSH_PORT" \
  --out-dir "$OUT_DIR_REL" \
  --container-name "$CONTAINER_NAME" \
  --service-name "$SERVICE_NAME" \
  --volume-name "$VOLUME_NAME"
EOF_RUN
chmod +x "$RUN_SCRIPT"

export PATH="$E2E_BIN:$PATH"
export DOCKER_GIT_E2E_REAL_SSH="$REAL_SSH"
export DOCKER_GIT_E2E_SSH_INVOCATION_LOG="$SSH_INVOCATION_LOG"
export DOCKER_GIT_E2E_SSH_SESSION_LOG="$SSH_SESSION_LOG"
export DOCKER_GIT_E2E_CONTAINER_NAME="$CONTAINER_NAME"
export DOCKER_GIT_SSH_KEY="$SSH_KEY"
export REPO_ROOT REPO_URL ROOT SSH_PORT OUT_DIR_REL CONTAINER_NAME SERVICE_NAME VOLUME_NAME

set +e
timeout "$CLONE_AUTO_OPEN_TIMEOUT" script -q -e -c "$RUN_SCRIPT" /dev/null >"$CLONE_LOG" 2>&1
clone_exit=$?
set -e
if [[ "$clone_exit" -eq 124 ]]; then
  fail "clone auto-open command timed out after $CLONE_AUTO_OPEN_TIMEOUT"
fi
if [[ "$clone_exit" -ne 0 ]]; then
  fail "clone auto-open command failed with exit code $clone_exit"
fi

grep -Fq -- "Project created: octocat/hello-world" "$CLONE_LOG" \
  || fail "expected clone log to confirm project creation"

grep -Fq -- "SSH terminal: octocat/hello-world" "$CLONE_LOG" \
  || fail "expected clone log to show SSH auto-open header"

[[ -f "$SSH_INVOCATION_LOG" ]] || fail "expected ssh wrapper to be invoked"
grep -Fq -- "<-tt>" "$SSH_INVOCATION_LOG" || fail "expected ssh to request a tty"
grep -Fq -- "<-Y>" "$SSH_INVOCATION_LOG" || fail "expected ssh to enable trusted X11 forwarding"
grep -Fq -- "<-o> <LogLevel=ERROR>" "$SSH_INVOCATION_LOG" || fail "expected ssh LogLevel=ERROR option"
grep -Fq -- "<-o> <StrictHostKeyChecking=no>" "$SSH_INVOCATION_LOG" \
  || fail "expected ssh StrictHostKeyChecking=no option"
grep -Fq -- "<-o> <UserKnownHostsFile=/dev/null>" "$SSH_INVOCATION_LOG" \
  || fail "expected ssh UserKnownHostsFile=/dev/null option"
grep -Fq -- "<-p> <$SSH_PORT>" "$SSH_INVOCATION_LOG" || fail "expected ssh port $SSH_PORT"
grep -Eq -- '<dev@(127[.]0[.]0[.]1|localhost)>' "$SSH_INVOCATION_LOG" \
  || fail "expected ssh target to be dev@127.0.0.1 or dev@localhost"
grep -Fq -- "exit: 0" "$SSH_INVOCATION_LOG" || fail "expected ssh command to succeed"

dg_project_docker exec -u dev "$CONTAINER_NAME" bash -lc "test -d '$TARGET_DIR/.git'" \
  || fail "expected cloned repo at: $TARGET_DIR"

grep -Fq -- "Контекст workspace: issue #1 (https://github.com/octocat/Hello-World/issues/1)" "$SSH_SESSION_LOG" \
  || fail "expected issue workspace context in auto-open SSH output"

grep -Fq -- "codex resume" "$SSH_SESSION_LOG" \
  || fail "expected codex resume hint in auto-open SSH output"

echo "e2e/clone-auto-open-ssh: clone auto-open SSH flow verified" >&2
