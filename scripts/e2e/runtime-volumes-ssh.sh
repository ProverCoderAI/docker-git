#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/runtime-volumes-ssh.XXXXXX")"
# docker-git containers may `chown -R` the project root when seeding runtime data.
# Keep host-side temp dirs writable for assertions and cleanup.
chmod 0777 "$ROOT"
mkdir -p "$ROOT/e2e"
chmod 0777 "$ROOT/e2e"
KEEP="${KEEP:-0}"

dg_ensure_docker "$ROOT/.e2e-bin"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0

REPO_URL="https://github.com/octocat/Hello-World/pull/1"
TARGET_DIR="/home/dev/workspaces/octocat/hello-world/pr-1"
OUT_DIR_REL=".docker-git/e2e/runtime-volumes-ssh-$RUN_ID"
OUT_DIR="$ROOT/e2e/runtime-volumes-ssh-$RUN_ID"
CONTAINER_NAME="dg-e2e-runtime-$RUN_ID"
SERVICE_NAME="dg-e2e-runtime-$RUN_ID"
VOLUME_NAME="dg-e2e-runtime-$RUN_ID-home"
SSH_PORT="$(( (RANDOM % 1000) + 23000 ))"
SSH_KEY="$ROOT/dev_ssh_key"
SSH_PUB_KEY="$ROOT/dev_ssh_key.pub"
CLONE_LOG="$ROOT/clone.log"
SSH_LOG="$ROOT/runtime-volumes-ssh.log"
HELPER_IMAGE=""

fail() {
  echo "e2e/runtime-volumes-ssh: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/runtime-volumes-ssh: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 80 || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" 2>/dev/null; then
    docker inspect "$CONTAINER_NAME" || true
    docker logs "$CONTAINER_NAME" --tail 200 || true
  fi
  if [[ -f "$CLONE_LOG" ]]; then
    echo "--- clone log ---" >&2
    cat "$CLONE_LOG" >&2 || true
  fi
  if [[ -f "$SSH_LOG" ]]; then
    echo "--- host ssh log ---" >&2
    cat "$SSH_LOG" >&2 || true
  fi
  if [[ -d "$OUT_DIR" ]] && [[ -f "$OUT_DIR/docker-compose.yml" ]]; then
    (cd "$OUT_DIR" && docker compose ps) || true
    (cd "$OUT_DIR" && docker compose logs --no-color --tail 200) || true
  fi
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/runtime-volumes-ssh: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/runtime-volumes-ssh: container name: $CONTAINER_NAME" >&2
    echo "e2e/runtime-volumes-ssh: out dir: $OUT_DIR" >&2
    return
  fi
  if [[ -d "$OUT_DIR" ]] && [[ -f "$OUT_DIR/docker-compose.yml" ]]; then
    (cd "$OUT_DIR" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

command -v script >/dev/null 2>&1 || fail "missing 'script' command (util-linux)"
command -v timeout >/dev/null 2>&1 || fail "missing 'timeout' command"
command -v ssh-keygen >/dev/null 2>&1 || fail "missing 'ssh-keygen' command"

mkdir -p "$ROOT/.docker-git/.orch/auth/codex"
ssh-keygen -q -t ed25519 -N "" -C "docker-git-e2e" -f "$SSH_KEY" >/dev/null
cp "$SSH_PUB_KEY" "$ROOT/authorized_keys"
chmod 0644 "$ROOT/authorized_keys" || true
dg_write_docker_host_file "$SSH_KEY" 600 < "$SSH_KEY"
dg_write_docker_host_file "$SSH_PUB_KEY" 644 < "$SSH_PUB_KEY"
dg_write_docker_host_file "$ROOT/authorized_keys" 644 < "$SSH_PUB_KEY"

# Seed a structurally valid auth.json so the shared Codex volume must be created
# and wired into the container runtime.
node <<'NODE' | dg_write_docker_host_file "$ROOT/.docker-git/.orch/auth/codex/auth.json" 600
const now = Math.floor(Date.now() / 1000)
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url")
const jwt = (payload) => `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sig`

const access = jwt({ exp: now + 3600, chatgpt_account_id: "org_test" })
const idToken = jwt({ exp: now + 3600, email: "ci@example.com" })

const auth = {
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: {
    id_token: idToken,
    access_token: access,
    refresh_token: "refresh_test",
    account_id: "org_test"
  },
  last_refresh: new Date().toISOString()
}

process.stdout.write(JSON.stringify(auth, null, 2))
NODE

mkdir -p "$OUT_DIR/.orch/env"
chmod 0777 "$OUT_DIR" "$OUT_DIR/.orch" "$OUT_DIR/.orch/env"
cat > "$OUT_DIR/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
EOF_ENV

(
  cd "$REPO_ROOT"
  pnpm run docker-git clone "$REPO_URL" \
    --force \
    --no-ssh \
    --authorized-keys "$ROOT/authorized_keys" \
    --ssh-port "$SSH_PORT" \
    --out-dir "$OUT_DIR_REL" \
    --container-name "$CONTAINER_NAME" \
    --service-name "$SERVICE_NAME" \
    --volume-name "$VOLUME_NAME"
) >"$CLONE_LOG" 2>&1

grep -Fq -- "Docker environment is up" "$CLONE_LOG" \
  || fail "expected clone log to confirm docker startup"

grep -Fq -- "SSH access: ssh -i $SSH_KEY" "$CLONE_LOG" \
  || fail "expected clone log to print SSH access command"

grep -Fq -- " -p $SSH_PORT dev@localhost" "$CLONE_LOG" \
  || fail "expected clone log to print the published SSH port"

docker exec -u dev "$CONTAINER_NAME" bash -lc "test -d '$TARGET_DIR/.git'" \
  || fail "expected cloned repo at: $TARGET_DIR"

MOUNTS_JSON="$(docker inspect --format '{{json .Mounts}}' "$CONTAINER_NAME")"
MOUNTS_JSON="$MOUNTS_JSON" HOME_VOLUME_NAME="$VOLUME_NAME" node <<'NODE'
const mounts = JSON.parse(process.env.MOUNTS_JSON)
const byDestination = new Map(mounts.map((mount) => [mount.Destination, mount]))

const expect = (condition, message) => {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

const homeMount = byDestination.get("/home/dev")
expect(homeMount && homeMount.Type === "volume", "expected /home/dev to be a named volume")
expect(
  homeMount.Name === process.env.HOME_VOLUME_NAME ||
    homeMount.Name.endsWith(`_${process.env.HOME_VOLUME_NAME}`),
  `unexpected /home/dev volume: ${homeMount && homeMount.Name}`
)

const cacheMount = byDestination.get("/home/dev/.docker-git/.cache")
expect(cacheMount && cacheMount.Type === "volume", "expected shared cache to be a named volume")
expect(cacheMount.Name === "docker-git-shared-cache", `unexpected cache volume: ${cacheMount && cacheMount.Name}`)

const codexSharedMount = byDestination.get("/home/dev/.codex-shared")
expect(codexSharedMount && codexSharedMount.Type === "volume", "expected shared Codex auth to be a named volume")
expect(codexSharedMount.Name === "docker-git-shared-codex", `unexpected Codex shared volume: ${codexSharedMount && codexSharedMount.Name}`)

expect(!byDestination.has("/home/dev/.docker-git"), "did not expect a direct bind mount for /home/dev/.docker-git")
expect(!byDestination.has("/home/dev/.codex"), "did not expect a direct bind mount for /home/dev/.codex")
expect(!byDestination.has("/home/dev/.ssh/authorized_keys"), "did not expect a direct bind mount for authorized_keys")
NODE

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.docker-git/authorized_keys' \
  || fail "expected authorized_keys to be mirrored into the home volume"

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.docker-git/.orch/env/global.env' \
  || fail "expected global env in docker-git runtime state"

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.docker-git/.orch/env/project.env' \
  || fail "expected project env in docker-git runtime state"

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.docker-git/.orch/auth/codex/config.toml' \
  || fail "expected bootstrap Codex config inside docker-git runtime state"

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.codex-shared/auth.json' \
  || fail "expected shared Codex auth volume to contain auth.json"

docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'test "$(readlink ~/.codex/auth.json)" = "/home/dev/.codex-shared/auth.json"' \
  || fail "expected ~/.codex/auth.json to point at the shared Codex volume"

HELPER_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_NAME")"

wait_for_ssh_ready() {
  local attempts=60
  local attempt=1

  while [[ "$attempt" -le "$attempts" ]]; do
    if docker run --rm --network host \
      -v "$ROOT":/mnt \
      --entrypoint bash \
      "$HELPER_IMAGE" \
      -lc "ssh -i /mnt/dev_ssh_key -T -o BatchMode=yes -o ConnectTimeout=2 -o ConnectionAttempts=1 -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p $SSH_PORT dev@localhost true" \
      >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    attempt="$((attempt + 1))"
  done

  return 1
}

wait_for_ssh_ready || fail "ssh did not become ready on localhost:$SSH_PORT"

set +e
timeout 45s script -q -e -c \
  "docker run --rm -i -t --network host -v \"$ROOT\":/mnt --entrypoint bash \"$HELPER_IMAGE\" -lc \"ssh -i /mnt/dev_ssh_key -tt -Y -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p $SSH_PORT dev@localhost \\\"bash -lic 'codex --version >/dev/null && exit'\\\"\"" \
  /dev/null >"$SSH_LOG" 2>&1
ssh_exit=$?
set -e

case "$ssh_exit" in
  0)
    ;;
  *)
    cat "$SSH_LOG" >&2 || true
    fail "host ssh probe failed (exit: $ssh_exit)"
    ;;
esac

grep -Fq -- "Контекст workspace: PR #1 (https://github.com/octocat/Hello-World/pull/1)" "$SSH_LOG" \
  || fail "expected PR workspace context in host ssh output"

grep -Fq -- "Старые сессии можно запустить с помощью codex resume" "$SSH_LOG" \
  || fail "expected codex resume hint in host ssh output"

echo "e2e/runtime-volumes-ssh: named volumes + host SSH CLI flow verified" >&2
