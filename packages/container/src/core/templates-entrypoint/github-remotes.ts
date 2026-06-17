const githubRemoteHelpersTemplate = String.raw`docker_git_github_repo_from_remote_url() {
  local remote_url="$1"
  local repo_path=""
  local owner=""
  local repo=""

  case "$remote_url" in
    https://github.com/*)
      repo_path="${"${"}remote_url#https://github.com/}"
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
}`

export const renderGitHubRemoteHelpers = (): string => githubRemoteHelpersTemplate
