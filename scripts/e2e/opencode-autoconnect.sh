#!/usr/bin/env bash
set -euo pipefail

RUN_ID="$(date +%s)-$RANDOM"
ROOT="$(mktemp -d)"
KEEP="${KEEP:-0}"

# Keep compose project/volume names unique to avoid interfering with any local docker-git state.
OUT_DIR_REL=".docker-git/e2e/opencode-autoconnect-$RUN_ID"
OUT_DIR="$ROOT/e2e/opencode-autoconnect-$RUN_ID"
CONTAINER_NAME="dg-e2e-opencode-$RUN_ID"
SERVICE_NAME="dg-e2e-opencode-$RUN_ID"
VOLUME_NAME="dg-e2e-opencode-$RUN_ID-home"
SSH_PORT="$(( (RANDOM % 1000) + 20000 ))"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"
export DOCKER_GIT_STATE_AUTO_SYNC=0

on_error() {
  local line="$1"
  echo "e2e/opencode-autoconnect: failed at line $line" >&2
  docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -n 50 || true
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" 2>/dev/null; then
    docker exec -u dev "$CONTAINER_NAME" bash -lc '
      echo "--- auth mounts ---"
      ls -la ~/.codex ~/.codex-shared ~/.local/share/opencode 2>/dev/null || true
      echo "--- opencode auth link ---"
      readlink -v ~/.local/share/opencode/auth.json 2>/dev/null || true
      echo "--- codex shared auth ---"
      ls -la ~/.codex-shared/auth.json 2>/dev/null || true
      echo "--- opencode shared auth ---"
      ls -la ~/.codex-shared/opencode 2>/dev/null || true
      ls -la ~/.codex-shared/opencode/auth.json 2>/dev/null || true
    ' || true
  fi
  if [[ -d "$OUT_DIR" ]] && [[ -f "$OUT_DIR/docker-compose.yml" ]]; then
    (cd "$OUT_DIR" && docker compose ps) || true
    (cd "$OUT_DIR" && docker compose logs --no-color --tail 200) || true
  fi
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/opencode-autoconnect: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/opencode-autoconnect: container name: $CONTAINER_NAME" >&2
    echo "e2e/opencode-autoconnect: out dir: $OUT_DIR" >&2
    return
  fi
  if [[ -d "$OUT_DIR" ]] && [[ -f "$OUT_DIR/docker-compose.yml" ]]; then
    (cd "$OUT_DIR" && docker compose down -v --remove-orphans) >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

# Ensure docker mounts a file (not an auto-created directory).
mkdir -p "$ROOT/.orch/auth/codex" "$ROOT/.orch/env"
: > "$ROOT/authorized_keys"

# Seed a fake (but structurally valid) Codex auth.json so the entrypoint can
# auto-connect OpenCode without manual /connect.
node <<'NODE' > "$ROOT/.orch/auth/codex/auth.json"
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

# Keep the container startup deterministic and fast for CI.
mkdir -p "$OUT_DIR/.orch/env"
cat > "$OUT_DIR/.orch/env/project.env" <<'EOF_ENV'
# docker-git project env (e2e)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=1
OPENCODE_SHARE_AUTH=1
OPENCODE_AUTO_CONNECT=1
EOF_ENV

pnpm run docker-git clone https://github.com/octocat/Hello-World \
  --force \
  --repo-ref master \
  --ssh-port "$SSH_PORT" \
  --out-dir "$OUT_DIR_REL" \
  --container-name "$CONTAINER_NAME" \
  --service-name "$SERVICE_NAME" \
  --volume-name "$VOLUME_NAME"

# Basic sanity checks.
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"

docker exec "$CONTAINER_NAME" opencode --version >/dev/null
docker exec -u dev "$CONTAINER_NAME" oh-my-opencode --version >/dev/null

docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'test -f ~/.config/opencode/opencode.json && grep -q "oh-my-opencode" ~/.config/opencode/opencode.json'

docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'test "$(readlink ~/.local/share/opencode/auth.json)" = "/home/dev/.codex-shared/opencode/auth.json"'

docker exec -u dev "$CONTAINER_NAME" bash -lc 'test -f ~/.codex-shared/auth.json'

docker exec -u dev "$CONTAINER_NAME" bash -lc \
  'node - <<'\''NODE'\''
const fs = require("fs")

const p = process.env.HOME + "/.local/share/opencode/auth.json"
const auth = JSON.parse(fs.readFileSync(p, "utf8"))
const openai = auth && auth.openai
if (!openai) process.exit(1)
if (openai.type === "oauth") {
  if (typeof openai.access !== "string" || openai.access.length === 0) process.exit(1)
  if (typeof openai.refresh !== "string" || openai.refresh.length === 0) process.exit(1)
  if (typeof openai.expires !== "number") process.exit(1)
  process.exit(0)
}
if (openai.type === "api") {
  if (typeof openai.key !== "string" || openai.key.length === 0) process.exit(1)
  process.exit(0)
}
process.exit(1)
NODE'

# Exercises Bun-based plugin install path (regression test for BUN_INSTALL env).
docker exec -u dev "$CONTAINER_NAME" opencode models openai | grep -m 1 -E '^openai/' >/dev/null
