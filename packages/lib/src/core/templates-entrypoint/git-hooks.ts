import { renderEntrypointGitPostPushWrapperInstall } from "./git-post-push-wrapper.js"

const entrypointGitHooksTemplate = String
  .raw`# 3) Install global git hooks to protect main/master + managed AGENTS context
HOOKS_DIR="/opt/docker-git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"
POST_PUSH_ACTION="$HOOKS_DIR/post-push"
PLAN_TO_GIT_CODEX_HOOK="$HOOKS_DIR/plan-to-git-codex-hook"
CODEX_REQUIREMENTS_FILE="/etc/codex/requirements.toml"
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

cat <<'EOF' > "$POST_PUSH_ACTION"
#!/usr/bin/env bash
set -euo pipefail

# 5) Run plan sync and session backup after successful push
REPO_ROOT="${"${"}DOCKER_GIT_POST_PUSH_REPO_ROOT:-}"
if [[ -z "$REPO_ROOT" || ! -d "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
cd "$REPO_ROOT"

# CHANGE: ensure an open GitHub PR exists for the pushed branch before PR-bound post-push tools run.
# WHY: issue #375 requires every successful git push to leave the branch with an open PR; plan sync and session backup both target PR discussion.
# REF: issue-375
docker_git_github_repo_from_remote_url() {
  local remote_url="$1"
  local repo_path=""
  local owner=""
  local repo=""

  case "$remote_url" in
    https://github.com/*)
      repo_path="${"${"}remote_url#https://github.com/}"
      ;;
    http://github.com/*)
      repo_path="${"${"}remote_url#http://github.com/}"
      ;;
    https://*@github.com/*)
      repo_path="${"${"}remote_url#https://*@github.com/}"
      ;;
    http://*@github.com/*)
      repo_path="${"${"}remote_url#http://*@github.com/}"
      ;;
    ssh://git@github.com/*)
      repo_path="${"${"}remote_url#ssh://git@github.com/}"
      ;;
    git@github.com:*)
      repo_path="${"${"}remote_url#git@github.com:}"
      ;;
    *)
      return 1
      ;;
  esac

  repo_path="${"${"}repo_path%%\?*}"
  repo_path="${"${"}repo_path%%#*}"
  repo_path="${"${"}repo_path%/}"
  repo_path="${"${"}repo_path%.git}"
  owner="${"${"}repo_path%%/*}"
  repo="${"${"}repo_path#*/}"
  repo="${"${"}repo%%/*}"
  repo="${"${"}repo%.git}"

  if [[ -z "$owner" || -z "$repo" || "$owner" == "$repo_path" ]]; then
    return 1
  fi

  printf "%s/%s\n" "$owner" "$repo"
}

docker_git_github_repo_from_remote() {
  local remote="$1"
  local remote_url=""

  remote_url="$(git remote get-url "$remote" 2>/dev/null || true)"
  if [[ -z "$remote_url" ]]; then
    return 1
  fi

  docker_git_github_repo_from_remote_url "$remote_url"
}

docker_git_ensure_open_pr() {
  local branch=""
  local base_repo=""
  local head_repo=""
  local head_owner=""
  local head_arg=""
  local base_branch=""
  local pr_url=""

  if ! command -v gh >/dev/null 2>&1; then
    echo "[post-push-pr] Error: gh CLI not found" >&2
    return 1
  fi

  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
    echo "[post-push-pr] Error: cannot create PR from detached HEAD" >&2
    return 1
  fi

  if ! base_repo="$(docker_git_github_repo_from_remote upstream)"; then
    if ! base_repo="$(docker_git_github_repo_from_remote origin)"; then
      echo "[post-push-pr] Skipped: no GitHub remote found"
      return 0
    fi
  fi

  if ! head_repo="$(docker_git_github_repo_from_remote origin)"; then
    head_repo="$base_repo"
  fi

  base_branch="$(gh repo view "$base_repo" --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)"
  if [[ -z "$base_branch" ]]; then
    echo "[post-push-pr] Error: failed to resolve default branch for $base_repo" >&2
    return 1
  fi

  if [[ "$head_repo" == "$base_repo" ]]; then
    head_arg="$branch"
  else
    head_owner="${"${"}head_repo%%/*}"
    head_arg="${"${"}head_owner}:${"${"}branch}"
  fi

  if ! pr_url="$(gh pr list --repo "$base_repo" --state open --head "$head_arg" --json url --jq '.[0].url // ""' 2>/dev/null)"; then
    echo "[post-push-pr] Error: failed to list open PRs for $head_arg in $base_repo" >&2
    return 1
  fi
  if [[ -z "$pr_url" && "$head_arg" != "$branch" ]]; then
    if ! pr_url="$(gh pr list --repo "$base_repo" --state open --head "$branch" --json url --jq '.[0].url // ""' 2>/dev/null)"; then
      echo "[post-push-pr] Error: failed to list open PRs for $branch in $base_repo" >&2
      return 1
    fi
  fi

  if [[ -n "$pr_url" ]]; then
    echo "[post-push-pr] Open PR: $pr_url"
    return 0
  fi

  echo "[post-push-pr] Creating PR for $head_arg into $base_repo:$base_branch"
  gh pr create --repo "$base_repo" --base "$base_branch" --head "$head_arg" --fill
}

docker_git_ensure_open_pr

# CHANGE: sync captured Codex plans to the current branch PR after push.
# WHY: issue #369 requires the agent plan to be uploaded to PR discussion.
# REF: issue-369
if [ "${"${"}DOCKER_GIT_SKIP_PLAN_TO_GIT:-}" != "1" ]; then
  if ! command -v plan-to-git >/dev/null 2>&1; then
    echo "[plan-to-git] Error: plan-to-git not found" >&2
    exit 1
  fi
  plan-to-git sync
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

plan-to-git hook --source codex
EOF
chmod 0755 "$PLAN_TO_GIT_CODEX_HOOK"

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

${renderEntrypointGitPostPushWrapperInstall()}

git config --system core.hooksPath "$HOOKS_DIR" || true
git config --global core.hooksPath "$HOOKS_DIR" || true`

export const renderEntrypointGitHooks = (): string => entrypointGitHooksTemplate
