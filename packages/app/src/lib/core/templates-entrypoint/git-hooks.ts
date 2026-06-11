import { renderEntrypointGitPostPushWrapperInstall } from "./git-post-push-wrapper.js"
import { renderPostPushPrEnsure } from "./post-push-pr.js"

const entrypointGitHooksTemplate = String
  .raw`# 3) Install global git hooks to protect main/master + managed AGENTS context
HOOKS_DIR="/opt/docker-git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"
POST_PUSH_ACTION="$HOOKS_DIR/post-push"
PLAN_TO_GIT_SYNC_HELPER="$HOOKS_DIR/plan-to-git-sync"
PLAN_TO_GIT_CODEX_HOOK="$HOOKS_DIR/plan-to-git-codex-hook"
PLAN_TO_GIT_CLAUDE_HOOK="$HOOKS_DIR/plan-to-git-claude-hook"
CODEX_REQUIREMENTS_FILE="/etc/codex/requirements.toml"
CLAUDE_PLAN_TO_GIT_SETTINGS_FILE="$CLAUDE_CONFIG_DIR/settings.json"
mkdir -p "$HOOKS_DIR"

cat <<'EOF' > "$PRE_PUSH_HOOK"
#!/usr/bin/env bash
set -euo pipefail

protected_branches=("refs/heads/main" "refs/heads/master")
allow_delete="${"${"}DOCKER_GIT_ALLOW_DELETE:-}"
zero_sha="0000000000000000000000000000000000000000"
issue_managed_start='<!-- docker-git:issue-managed:start -->'
issue_managed_end='<!-- docker-git:issue-managed:end -->'

extract_issue_block() {
  local ref="$1"

  if ! git cat-file -e "$ref" 2>/dev/null; then
    return 0
  fi

  local awk_status=0
  if ! git cat-file -p "$ref" | awk -v start="$issue_managed_start" -v end="$issue_managed_end" '
    BEGIN { in_block = 0; found = 0 }
    $0 == start { in_block = 1; found = 1 }
    in_block == 1 { print }
    $0 == end && in_block == 1 { in_block = 0; exit }
    END {
      if (found == 0) exit 3
      if (in_block == 1) exit 2
    }
  '; then
    awk_status=$?
    if [[ "$awk_status" -eq 3 ]]; then
      return 0
    fi
    return "$awk_status"
  fi
}

commit_changes_issue_block() {
  local commit="$1"
  local parent=""
  local commit_block=""
  local parent_block=""

  if ! git diff-tree --no-commit-id --name-only -r "$commit" -- AGENTS.md | grep -qx "AGENTS.md"; then
    return 1
  fi

  if ! commit_block="$(extract_issue_block "$commit:AGENTS.md")"; then
    return 2
  fi

  parent="$(git rev-list --parents -n 1 "$commit" | awk '{print $2}')"
  if [[ -n "$parent" ]]; then
    if ! parent_block="$(extract_issue_block "$parent:AGENTS.md")"; then
      return 2
    fi
  fi

  if [[ "$commit_block" != "$parent_block" ]]; then
    return 0
  fi
  return 1
}

check_issue_managed_block_range() {
  local local_sha="$1"
  local remote_sha="$2"
  local commits=""
  local commit=""
  local guard_status=0

  if [[ "$local_sha" == "$zero_sha" ]]; then
    return 0
  fi

  if [[ "$remote_sha" == "$zero_sha" ]]; then
    commits="$(git rev-list "$local_sha" --not --remotes 2>/dev/null || true)"
    if [[ -z "$commits" ]]; then
      commits="$local_sha"
    fi
  else
    commits="$(git rev-list "$remote_sha..$local_sha" 2>/dev/null || true)"
  fi

  for commit in $commits; do
    commit_changes_issue_block "$commit"
    guard_status=$?
    if [[ "$guard_status" -eq 0 ]]; then
      echo "docker-git: push contains commit updating managed issue block in AGENTS.md: $commit"
      echo "docker-git: this block is runtime context and must stay outside repository history."
      return 1
    fi
    if [[ "$guard_status" -eq 2 ]]; then
      echo "docker-git: failed to parse managed issue block in AGENTS.md for commit $commit"
      echo "docker-git: push blocked to prevent committing runtime workspace metadata."
      return 1
    fi
  done

  return 0
}

while read -r local_ref local_sha remote_ref remote_sha; do
  if [[ -z "$remote_ref" ]]; then
    continue
  fi
  for protected in "${"${"}protected_branches[@]}"; do
    if [[ "$remote_ref" == "$protected" || "$local_ref" == "$protected" ]]; then
      echo "docker-git: push to protected branch '${"${"}protected##*/}' is disabled."
      echo "docker-git: create a new branch: git checkout -b <name>"
      exit 1
    fi
  done
  if ! check_issue_managed_block_range "$local_sha" "$remote_sha"; then
    exit 1
  fi
  if [[ "$local_sha" == "$zero_sha" && "$remote_ref" == refs/heads/* ]]; then
    if [[ "$allow_delete" != "1" ]]; then
      echo "docker-git: deleting remote branches is disabled (set DOCKER_GIT_ALLOW_DELETE=1 to override)."
      exit 1
    fi
  fi
done
EOF
chmod 0755 "$PRE_PUSH_HOOK"

cat <<'EOF' > "$PLAN_TO_GIT_SYNC_HELPER"
#!/usr/bin/env bash
set -euo pipefail

if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" = "1" ]; then
  exit 0
fi

if ! command -v plan-to-git >/dev/null 2>&1; then
  echo "[plan-to-git] Error: plan-to-git not found" >&2
  exit 1
fi

export PLAN_TO_GIT_STATE_DIR="${"${"}PLAN_TO_GIT_STATE_DIR:-/tmp/plan-to-git}"

docker_git_plan_to_git_explicit_pr_supported() {
  plan-to-git sync --help 2>/dev/null | grep -q -- "--pr <PR>"
}

docker_git_plan_to_git_resolve_pr_number() {
  local candidate=""
  local key=""
  for key in DOCKER_GIT_PR_NUMBER PR_NUMBER GITHUB_PR_NUMBER; do
    candidate="${"${"}!key:-}"
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  candidate="${"${"}REPO_REF:-}"
  if [[ "$candidate" =~ ^refs/pull/([0-9]+)/head$ ]]; then
    printf "%s\n" "${"${"}BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$candidate" =~ ^pull/([0-9]+)$ ]]; then
    printf "%s\n" "${"${"}BASH_REMATCH[1]}"
    return 0
  fi

  if command -v gh >/dev/null 2>&1; then
    candidate="$(gh pr view --json number --jq .number 2>/dev/null || true)"
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  fi

  return 0
}

docker_git_plan_to_git_sync() {
  local pr_number=""
  pr_number="$(docker_git_plan_to_git_resolve_pr_number || true)"

  if [[ -n "$pr_number" ]] && docker_git_plan_to_git_explicit_pr_supported; then
    echo "[plan-to-git] Syncing queued agent plans to PR #$pr_number"
    plan-to-git sync --pr "$pr_number"
    return 0
  fi

  echo "[plan-to-git] Syncing queued agent plans via current branch discovery"
  plan-to-git sync
}

docker_git_plan_to_git_sync
EOF
chmod 0755 "$PLAN_TO_GIT_SYNC_HELPER"

cat <<'EOF' > "$POST_PUSH_ACTION"
#!/usr/bin/env bash
set -euo pipefail

# 5) Run plan sync and session backup after successful push
REPO_ROOT="${"${"}DOCKER_GIT_POST_PUSH_REPO_ROOT:-}"
if [[ -z "$REPO_ROOT" || ! -d "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
cd "$REPO_ROOT"

${renderPostPushPrEnsure()}

# CHANGE: backfill agent session plans before syncing the current branch or explicit PR.
# WHY: live agent hooks can be unavailable in already-running sessions; session logs are the durable fallback.
# QUOTE(ТЗ): "что бы всё уходило на гитхаб автоматически"
# REF: issue-397
if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" != "1" ]; then
  if ! command -v plan-to-git >/dev/null 2>&1; then
    echo "[plan-to-git] Error: plan-to-git not found" >&2
    exit 1
  fi
  plan-to-git import-codex --no-sync
  plan-to-git import-claude --no-sync
  PLAN_TO_GIT_SYNC_HELPER="${"${"}DOCKER_GIT_PLAN_TO_GIT_SYNC_HELPER:-/opt/docker-git/hooks/plan-to-git-sync}"
  if [[ -x "$PLAN_TO_GIT_SYNC_HELPER" ]]; then
    "$PLAN_TO_GIT_SYNC_HELPER"
  else
    echo "[plan-to-git] Sync helper not found; falling back to current branch discovery" >&2
    plan-to-git sync
  fi
fi

# CHANGE: keep post-push backup logic in a reusable action script
# WHY: git has no client-side post-push hook, so the global git wrapper
#      invokes this after a successful git push
# REF: issue-192
if [ "${"${"}DOCKER_GIT_SKIP_SESSION_BACKUP:-}" != "1" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "[session-backup] Error: gh CLI not found"
    exit 1
  fi
  if ! command -v docker-git-session-sync >/dev/null 2>&1; then
    echo "[session-backup] Error: docker-git-session-sync not found"
    exit 1
  fi
  DOCKER_GIT_SKIP_POST_PUSH_ACTION=1 docker-git-session-sync backup --verbose --background --require-comment
fi
EOF
chmod 0755 "$POST_PUSH_ACTION"

cat <<'EOF' > "$PLAN_TO_GIT_CODEX_HOOK"
#!/usr/bin/env bash
set -euo pipefail

if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" = "1" ]; then
  exit 0
fi

if ! command -v plan-to-git >/dev/null 2>&1; then
  echo "[plan-to-git] Error: plan-to-git not found" >&2
  exit 1
fi

export PLAN_TO_GIT_STATE_DIR="${"${"}PLAN_TO_GIT_STATE_DIR:-/tmp/plan-to-git}"
plan-to-git hook --source codex
PLAN_TO_GIT_SYNC_HELPER="${"${"}DOCKER_GIT_PLAN_TO_GIT_SYNC_HELPER:-/opt/docker-git/hooks/plan-to-git-sync}"
"$PLAN_TO_GIT_SYNC_HELPER" >&2 || true
EOF
chmod 0755 "$PLAN_TO_GIT_CODEX_HOOK"

cat <<'EOF' > "$PLAN_TO_GIT_CLAUDE_HOOK"
#!/usr/bin/env bash
set -euo pipefail

if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" = "1" ]; then
  exit 0
fi

if ! command -v plan-to-git >/dev/null 2>&1; then
  echo "[plan-to-git] Error: plan-to-git not found" >&2
  exit 1
fi

export PLAN_TO_GIT_STATE_DIR="${"${"}PLAN_TO_GIT_STATE_DIR:-/tmp/plan-to-git}"
plan-to-git hook --source claude
PLAN_TO_GIT_SYNC_HELPER="${"${"}DOCKER_GIT_PLAN_TO_GIT_SYNC_HELPER:-/opt/docker-git/hooks/plan-to-git-sync}"
"$PLAN_TO_GIT_SYNC_HELPER" >&2 || true
EOF
chmod 0755 "$PLAN_TO_GIT_CLAUDE_HOOK"

mkdir -p "$(dirname "$CODEX_REQUIREMENTS_FILE")"
cat <<'EOF' > "$CODEX_REQUIREMENTS_FILE"
# docker-git managed Codex requirements

[features]
hooks = true

[hooks]
managed_dir = "/opt/docker-git/hooks"

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "/opt/docker-git/hooks/plan-to-git-codex-hook"
statusMessage = "Capturing plan decision"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "/opt/docker-git/hooks/plan-to-git-codex-hook"
statusMessage = "Capturing agent plan"
EOF
chmod 0644 "$CODEX_REQUIREMENTS_FILE"

docker_git_install_claude_plan_to_git_hooks() {
  if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" = "1" ]; then
    return 0
  fi

  CLAUDE_PLAN_TO_GIT_SETTINGS_FILE="${"${"}CLAUDE_PLAN_TO_GIT_SETTINGS_FILE:-${"${"}CLAUDE_CONFIG_DIR:-/home/dev/.claude}/settings.json}"
  CLAUDE_PLAN_TO_GIT_SETTINGS_FILE="$CLAUDE_PLAN_TO_GIT_SETTINGS_FILE" PLAN_TO_GIT_CLAUDE_HOOK="$PLAN_TO_GIT_CLAUDE_HOOK" node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const settingsPath = process.env.CLAUDE_PLAN_TO_GIT_SETTINGS_FILE
const hookCommand = process.env.PLAN_TO_GIT_CLAUDE_HOOK || "/opt/docker-git/hooks/plan-to-git-claude-hook"
if (typeof settingsPath !== "string" || settingsPath.length === 0) {
  process.exit(0)
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

let settings = {}
try {
  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"))
  settings = isRecord(parsed) ? parsed : {}
} catch {
  settings = {}
}

const currentHooks = isRecord(settings.hooks) ? settings.hooks : {}
const nextHooks = { ...currentHooks }
const managedHook = { type: "command", command: hookCommand }
const ensureEventHook = (eventName) => {
  const currentEventHooks = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
  const alreadyInstalled = currentEventHooks.some((entry) =>
    isRecord(entry) &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some((hook) => isRecord(hook) && hook.type === "command" && hook.command === hookCommand)
  )
  nextHooks[eventName] = alreadyInstalled ? currentEventHooks : [...currentEventHooks, { hooks: [managedHook] }]
}

ensureEventHook("UserPromptSubmit")
ensureEventHook("Stop")

const nextSettings = { ...settings, hooks: nextHooks }
if (JSON.stringify(settings) === JSON.stringify(nextSettings)) {
  process.exit(0)
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n", { mode: 0o600 })
NODE
  chmod 0600 "$CLAUDE_PLAN_TO_GIT_SETTINGS_FILE" 2>/dev/null || true
  chown 1000:1000 "$CLAUDE_PLAN_TO_GIT_SETTINGS_FILE" 2>/dev/null || true
}

docker_git_install_claude_plan_to_git_hooks

${renderEntrypointGitPostPushWrapperInstall()}

git config --system core.hooksPath "$HOOKS_DIR" || true
git config --global core.hooksPath "$HOOKS_DIR" || true`

export const renderEntrypointGitHooks = (): string => entrypointGitHooksTemplate
