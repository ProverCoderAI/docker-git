#!/usr/bin/env bash
set -euo pipefail

# E2E regression test for Issue #61:
# - multiple labeled auth entries in ~/.docker-git/.orch
# - non-interactive auth storage
# - project label binding (distributing the selected label into a project env)
# - state auto-sync commits/pushes without user interaction

RUN_ID="$(date +%s)-$RANDOM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/e2e/_lib.sh"
ROOT_BASE="${DOCKER_GIT_E2E_ROOT_BASE:-$REPO_ROOT/.docker-git/e2e-root}"
mkdir -p "$ROOT_BASE"
ROOT="$(mktemp -d "$ROOT_BASE/issue-61-auth-labels.XXXXXX")"
chmod 0777 "$ROOT"
KEEP="${KEEP:-0}"

export DOCKER_GIT_PROJECTS_ROOT="$ROOT"

# Keep the bare origin remote outside the state repo root so auto-sync commits
# don't accidentally include its objects/refs.
REMOTE="$(mktemp -d "$ROOT_BASE/issue-61-auth-labels-remote.XXXXXX")"

fail() {
  echo "e2e/issue-61-auth-labels: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "e2e/issue-61-auth-labels: failed at line $line" >&2
  if [[ -d "$ROOT/.git" ]]; then
    git -C "$ROOT" status -sb --porcelain=v1 || true
    git -C "$ROOT" log -n 10 --oneline || true
  fi
}

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "e2e/issue-61-auth-labels: KEEP=1 set; preserving temp dir: $ROOT" >&2
    echo "e2e/issue-61-auth-labels: preserving bare remote: $REMOTE" >&2
    return
  fi
  rm -rf "$ROOT" "$REMOTE" >/dev/null 2>&1 || true
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

# Prepare an isolated state repo at $ROOT with a local bare origin.
mkdir -p "$ROOT/.orch/env"
cat > "$ROOT/.orch/env/global.env" <<'EOF_ENV'
# docker-git env
# KEY=value
EOF_ENV

git -C "$ROOT" init -b main >/dev/null
git -C "$ROOT" config user.email "e2e@example.com"
git -C "$ROOT" config user.name "docker-git e2e"
git -C "$ROOT" add -A
git -C "$ROOT" commit -m "chore(e2e): init state" >/dev/null
git init --bare --initial-branch=main "$REMOTE" >/dev/null
git -C "$ROOT" remote add origin "$REMOTE"
git -C "$ROOT" push --no-verify -u origin main >/dev/null

# Enable auto-sync. This should commit+push to the local bare remote above.
export DOCKER_GIT_STATE_AUTO_SYNC=1

default_token="token_default_$RUN_ID"
agiens_token="token_agiens_$RUN_ID"
git_token="git_token_$RUN_ID"
claude_key="claude_key_$RUN_ID"

# 1) Store multiple GitHub tokens by label (non-interactive / CI path).
(
  cd "$REPO_ROOT"
  pnpm run docker-git auth gh login --token "$default_token"
)
(
  cd "$REPO_ROOT"
  pnpm run docker-git auth gh login --token "$agiens_token" --label agiens
)

grep -Fq -- "GITHUB_TOKEN=$default_token" "$ROOT/.orch/env/global.env" \
  || fail "expected GITHUB_TOKEN to be stored in global.env"
grep -Fq -- "GITHUB_TOKEN__AGIENS=$agiens_token" "$ROOT/.orch/env/global.env" \
  || fail "expected GITHUB_TOKEN__AGIENS to be stored in global.env"

# Ensure state auto-sync actually committed and pushed.
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || fail "state repo has uncommitted changes"
[[ "$(git --git-dir "$REMOTE" log -1 --pretty=%s)" == "chore(state): auth gh AGIENS" ]] \
  || fail "expected latest remote commit to come from labeled GH auth"

# 2) Set labeled Git credentials + Claude key via the same menu logic (non-interactive).
PROJECT_DIR="$ROOT/e2e/project-1"
PROJECT_ENV="$PROJECT_DIR/.orch/env/project.env"
mkdir -p "$(dirname "$PROJECT_ENV")"
cat > "$PROJECT_ENV" <<'EOF_ENV'
# docker-git project env (e2e)
EOF_ENV

(
  cd "$REPO_ROOT/packages/app"
  PROJECT_DIR="$PROJECT_DIR" \
  PROJECT_ENV_PATH="$PROJECT_ENV" \
  GIT_TOKEN_VALUE="$git_token" \
  CLAUDE_KEY_VALUE="$claude_key" \
  node --input-type=module <<'NODE'
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { writeAuthFlow } from "./dist/src/docker-git/menu-auth-data.js"
import { writeProjectAuthFlow } from "./dist/src/docker-git/menu-project-auth-data.js"

const projectDir = process.env.PROJECT_DIR ?? ""
const envProjectPath = process.env.PROJECT_ENV_PATH ?? ""
if (projectDir.length === 0 || envProjectPath.length === 0) {
  throw new Error("missing PROJECT_DIR / PROJECT_ENV_PATH")
}

const gitToken = process.env.GIT_TOKEN_VALUE ?? ""
const claudeKey = process.env.CLAUDE_KEY_VALUE ?? ""
if (gitToken.length === 0 || claudeKey.length === 0) {
  throw new Error("missing GIT_TOKEN_VALUE / CLAUDE_KEY_VALUE")
}

const project = {
  projectDir,
  displayName: "e2e/project-1",
  envProjectPath
}

const main = Effect.gen(function*(_) {
  // Create labeled profiles in ~/.docker-git/.orch/env/global.env
  yield* _(writeAuthFlow(process.cwd(), "GitSet", { label: "agiens", token: gitToken, user: "x-access-token" }))
  yield* _(writeAuthFlow(process.cwd(), "ClaudeSet", { label: "agiens", apiKey: claudeKey }))

  // Bind them into the project env.
  yield* _(writeProjectAuthFlow(project, "ProjectGithubConnect", { label: "agiens" }))
  yield* _(writeProjectAuthFlow(project, "ProjectGitConnect", { label: "agiens" }))
  yield* _(writeProjectAuthFlow(project, "ProjectClaudeConnect", { label: "agiens" }))
})

NodeRuntime.runMain(Effect.provide(main, NodeContext.layer))
NODE
)

grep -Fq -- "GITHUB_AUTH_LABEL=AGIENS" "$PROJECT_ENV" || fail "expected GITHUB_AUTH_LABEL=AGIENS in project.env"
grep -Fq -- "GIT_AUTH_LABEL=AGIENS" "$PROJECT_ENV" || fail "expected GIT_AUTH_LABEL=AGIENS in project.env"
grep -Fq -- "CLAUDE_AUTH_LABEL=AGIENS" "$PROJECT_ENV" || fail "expected CLAUDE_AUTH_LABEL=AGIENS in project.env"
grep -Fq -- "GIT_AUTH_TOKEN=$git_token" "$PROJECT_ENV" || fail "expected bound GIT_AUTH_TOKEN in project.env"
grep -Fq -- "GIT_AUTH_USER=x-access-token" "$PROJECT_ENV" || fail "expected bound GIT_AUTH_USER in project.env"
grep -Fq -- "GH_TOKEN=$git_token" "$PROJECT_ENV" || fail "expected bound GH_TOKEN in project.env"
grep -Fq -- "ANTHROPIC_API_KEY=$claude_key" "$PROJECT_ENV" || fail "expected bound ANTHROPIC_API_KEY in project.env"

[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || fail "state repo not clean after project bindings"
last_msg="$(git --git-dir "$REMOTE" log -1 --pretty=%s)"
[[ "$last_msg" == "chore(state): project auth claude AGIENS e2e/project-1" ]] \
  || fail "expected latest remote commit to come from project claude binding; got: $last_msg"

echo "e2e/issue-61-auth-labels: OK (multi-label auth + project bindings + state auto-sync)" >&2
