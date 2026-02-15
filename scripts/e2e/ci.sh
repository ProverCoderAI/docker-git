#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

E2E_ROOT="${ROOT_DIR}/.e2e"
BIN_DIR="${E2E_ROOT}/bin"
LOG_DIR="${E2E_ROOT}/logs"
PROJECTS_ROOT="${E2E_ROOT}/projects"

REPO_URL="https://github.com/octocat/Hello-World/issues/1"
OUT_DIR="${PROJECTS_ROOT}/octocat/hello-world/issue-1"
CONTAINER_NAME="dg-hello-world-issue-1"
TARGET_DIR="/home/dev/octocat/hello-world/issue-1"

SSH_LOG="${LOG_DIR}/ssh.log"
ENV_PROJECT="${E2E_ROOT}/project.env"
SSH_PORT="${E2E_SSH_PORT:-}"

fail() {
  echo "e2e: $*" >&2
  exit 1
}

cleanup() {
  if [[ -d "$OUT_DIR" ]]; then
    (
      cd "$OUT_DIR" && docker compose down -v >/dev/null 2>&1 || true
    )
  fi
}
trap cleanup EXIT

mkdir -p "$BIN_DIR" "$LOG_DIR" "$PROJECTS_ROOT"
rm -f "$SSH_LOG"

cat > "$ENV_PROJECT" <<'EOF'
# Keep CI fast and deterministic (Codex auto-update hits the network on container start)
CODEX_AUTO_UPDATE=0
CODEX_SHARE_AUTH=0
EOF

export DOCKER_GIT_PROJECTS_ROOT="$PROJECTS_ROOT"

cat > "$BIN_DIR/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${SSH_LOG_PATH:?SSH_LOG_PATH is required}"
printf "ssh %s\n" "$*" >> "$SSH_LOG_PATH"
exit 0
EOF
chmod +x "$BIN_DIR/ssh"

export SSH_LOG_PATH="$SSH_LOG"
export PATH="$BIN_DIR:$PATH"

cd "$ROOT_DIR"

pnpm --filter ./packages/app build:docker-git

command -v script >/dev/null 2>&1 || fail "missing 'script' command (util-linux)"

if [[ -z "$SSH_PORT" ]]; then
  SSH_PORT="$(node -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port); s.close();});')"
fi

script -q -e -c "node packages/app/dist/src/docker-git/main.js clone \"$REPO_URL\" --force --ssh-port \"$SSH_PORT\" --env-project \"$ENV_PROJECT\"" /dev/null

[[ -s "$SSH_LOG" ]] || fail "expected ssh to be invoked; log is empty: $SSH_LOG"
grep -q "dev@localhost" "$SSH_LOG" || fail "expected ssh args to include dev@localhost; got: $(cat "$SSH_LOG")"
grep -q -- "-p " "$SSH_LOG" || fail "expected ssh args to include -p <port>; got: $(cat "$SSH_LOG")"

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME" || fail "expected container to be running: $CONTAINER_NAME"
docker exec "$CONTAINER_NAME" bash -lc "test -d '$TARGET_DIR/.git'" || fail "expected repo to be cloned at: $TARGET_DIR"
branch="$(docker exec "$CONTAINER_NAME" bash -lc "cd '$TARGET_DIR' && git rev-parse --abbrev-ref HEAD")"
[[ "$branch" == "issue-1" ]] || fail "expected HEAD branch issue-1, got: $branch"

[[ -f "$OUT_DIR/docker-git.json" ]] || fail "expected project config file: $OUT_DIR/docker-git.json"

echo "e2e: OK"
