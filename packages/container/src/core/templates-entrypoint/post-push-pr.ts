const postPushPrEnsureTemplate = String
  .raw`# CHANGE: ensure an open GitHub PR exists for the pushed branch before PR-bound post-push tools run.
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
    https://github.com/*)
      repo_path="${"${"}remote_url#https://github.com/}"
      ;;
    https://*@github.com/*)
      repo_path="${"${"}remote_url#https://*@github.com/}"
      ;;
    https://*@github.com/*)
      repo_path="${"${"}remote_url#https://*@github.com/}"
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

docker_git_ensure_open_pr`

export const renderPostPushPrEnsure = (): string => postPushPrEnsureTemplate
