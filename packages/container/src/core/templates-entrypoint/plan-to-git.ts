import { renderGitHubRemoteHelpers } from "./github-remotes.js"

const planToGitHookPathsTemplate = `PLAN_TO_GIT_SYNC_HELPER="$HOOKS_DIR/plan-to-git-sync"
PLAN_TO_GIT_CODEX_HOOK="$HOOKS_DIR/plan-to-git-codex-hook"
PLAN_TO_GIT_CLAUDE_HOOK="$HOOKS_DIR/plan-to-git-claude-hook"
CODEX_REQUIREMENTS_FILE="/etc/codex/requirements.toml"
CLAUDE_PLAN_TO_GIT_SETTINGS_FILE="$CLAUDE_CONFIG_DIR/settings.json"`

const planToGitRunnerTemplate = String.raw`${renderGitHubRemoteHelpers()}

docker_git_plan_to_git_run() {
  local base_repo=""
  local origin_repo=""
  local origin_url=""
  local base_url=""
  local config_index="0"

  if ! base_repo="$(docker_git_github_repo_from_remote upstream)"; then
    base_repo="$(docker_git_github_repo_from_remote origin || true)"
  fi
  origin_repo="$(docker_git_github_repo_from_remote origin || true)"
  origin_url="$(git remote get-url origin 2>/dev/null || true)"

  if [[ -z "$base_repo" || -z "$origin_repo" || -z "$origin_url" ]]; then
    plan-to-git "$@"
    return $?
  fi

  if [[ "$origin_repo" == "$base_repo" ]]; then
    plan-to-git "$@"
    return $?
  fi

  base_url="https://github.com/${"${"}base_repo}.git"
  config_index="${"${"}GIT_CONFIG_COUNT:-0}"
  if ! [[ "$config_index" =~ ^[0-9]+$ ]]; then
    config_index="0"
  fi

  env \
    GIT_CONFIG_COUNT="$((config_index + 1))" \
    "GIT_CONFIG_KEY_${"${"}config_index}=url.${"${"}base_url}.insteadOf" \
    "GIT_CONFIG_VALUE_${"${"}config_index}=${"${"}origin_url}" \
    plan-to-git "$@"
}`

const planToGitSyncHelperInstallTemplate = String.raw`cat <<'EOF' > "$PLAN_TO_GIT_SYNC_HELPER"
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

${planToGitRunnerTemplate}

docker_git_plan_to_git_explicit_pr_supported() {
  docker_git_plan_to_git_run sync --help 2>/dev/null | grep -q -- "--pr <PR>"
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
    docker_git_plan_to_git_run sync --pr "$pr_number"
    return 0
  fi

  echo "[plan-to-git] Syncing queued agent plans via current branch discovery"
  docker_git_plan_to_git_run sync
}

docker_git_plan_to_git_sync
EOF
chmod 0755 "$PLAN_TO_GIT_SYNC_HELPER"`

const planToGitPostPushSyncTemplate =
  `# CHANGE: backfill agent session plans before syncing the current branch or explicit PR.
# WHY: live agent hooks can be unavailable in already-running sessions; session logs are the durable fallback.
# QUOTE(ТЗ): "что бы всё уходило на гитхаб автоматически"
# REF: issue-397
if [ "\${DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" != "1" ]; then
  if ! command -v plan-to-git >/dev/null 2>&1; then
    echo "[plan-to-git] Error: plan-to-git not found" >&2
    exit 1
  fi
  ${planToGitRunnerTemplate}
  docker_git_plan_to_git_run import-codex --no-sync
  docker_git_plan_to_git_run import-claude --no-sync
  PLAN_TO_GIT_SYNC_HELPER="\${DOCKER_GIT_PLAN_TO_GIT_SYNC_HELPER:-/opt/docker-git/hooks/plan-to-git-sync}"
  if [[ -x "$PLAN_TO_GIT_SYNC_HELPER" ]]; then
    "$PLAN_TO_GIT_SYNC_HELPER"
  else
    echo "[plan-to-git] Sync helper not found; falling back to current branch discovery" >&2
    docker_git_plan_to_git_run sync
  fi
fi`

const planToGitAgentHooksInstallTemplate = String.raw`cat <<'EOF' > "$PLAN_TO_GIT_CODEX_HOOK"
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
${planToGitRunnerTemplate}
docker_git_plan_to_git_run hook --source codex
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
${planToGitRunnerTemplate}
docker_git_plan_to_git_run hook --source claude
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

docker_git_install_claude_plan_to_git_hooks`

export const renderPlanToGitHookPaths = (): string => planToGitHookPathsTemplate

export const renderPlanToGitSyncHelperInstall = (): string => planToGitSyncHelperInstallTemplate

export const renderPlanToGitPostPushSync = (): string => planToGitPostPushSyncTemplate

export const renderPlanToGitAgentHooksInstall = (): string => planToGitAgentHooksInstallTemplate
