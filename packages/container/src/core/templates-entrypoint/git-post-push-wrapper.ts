const entrypointGitPostPushWrapperInstall =
  `# 5.5) Install git wrapper so post-push actions run for normal git push invocations.
# Git has no client-side post-push hook, so core.hooksPath alone is insufficient.
GIT_WRAPPER_BIN="/usr/local/bin/git"
GIT_REAL_BIN="$(type -aP git | awk -v wrapper="$GIT_WRAPPER_BIN" '$0 != wrapper { print; exit }')"
if [[ -n "$GIT_REAL_BIN" ]]; then
  cat <<'EOF' > "$GIT_WRAPPER_BIN"
#!/usr/bin/env bash
set -euo pipefail

# docker-git managed git wrapper
DOCKER_GIT_REAL_GIT_BIN="__DOCKER_GIT_REAL_BIN__"
DOCKER_GIT_POST_PUSH_ACTION="/opt/docker-git/hooks/post-push"

docker_git_git_subcommand() {
  local expect_value="0"
  local arg=""
  for arg in "$@"; do
    if [[ "$expect_value" == "1" ]]; then
      expect_value="0"
      continue
    fi

    case "$arg" in
      --help|-h|--version|--html-path|--man-path|--info-path|--list-cmds|--list-cmds=*)
        return 1
        ;;
      -c|-C|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)
        expect_value="1"
        continue
        ;;
      --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--super-prefix=*|--config-env=*|--bare|--no-pager|--paginate|--literal-pathspecs|--no-literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch)
        continue
        ;;
      --)
        return 1
        ;;
      -*)
        continue
        ;;
      *)
        printf "%s" "$arg"
        return 0
        ;;
    esac
  done

  return 1
}

docker_git_git_resolve_repo_root() {
  local -a git_context=()
  local expect_value="0"
  local arg=""

  for arg in "$@"; do
    if [[ "$expect_value" == "1" ]]; then
      git_context+=("$arg")
      expect_value="0"
      continue
    fi

    case "$arg" in
      -c|-C|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)
        git_context+=("$arg")
        expect_value="1"
        continue
        ;;
      --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--super-prefix=*|--config-env=*|--bare|--no-pager|--paginate|--literal-pathspecs|--no-literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch)
        git_context+=("$arg")
        continue
        ;;
      --)
        break
        ;;
      -*)
        continue
        ;;
      *)
        break
        ;;
    esac
  done

  "$DOCKER_GIT_REAL_GIT_BIN" "\${git_context[@]}" rev-parse --show-toplevel 2>/dev/null
}

docker_git_git_push_is_dry_run() {
  local expect_value="0"
  local parsing_push_args="0"
  local arg=""

  for arg in "$@"; do
    if [[ "$parsing_push_args" == "0" ]]; then
      if [[ "$expect_value" == "1" ]]; then
        expect_value="0"
        continue
      fi

      case "$arg" in
        -c|-C|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)
          expect_value="1"
          continue
          ;;
        --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|--super-prefix=*|--config-env=*|--bare|--no-pager|--paginate|--literal-pathspecs|--no-literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch)
          continue
          ;;
        push)
          parsing_push_args="1"
          continue
          ;;
      esac

      continue
    fi

    case "$arg" in
      --)
        break
        ;;
      --dry-run|-n)
        return 0
        ;;
    esac
  done

  return 1
}

docker_git_post_push_action() {
  local repo_root=""

  if [[ "\${DOCKER_GIT_SKIP_POST_PUSH_ACTION:-}" == "1" ]]; then
    return 0
  fi

  if [[ -x "$DOCKER_GIT_POST_PUSH_ACTION" ]]; then
    if repo_root="$(docker_git_git_resolve_repo_root "$@")" && [[ -n "$repo_root" ]]; then
      DOCKER_GIT_POST_PUSH_REPO_ROOT="$repo_root" DOCKER_GIT_SKIP_POST_PUSH_ACTION=1 "$DOCKER_GIT_POST_PUSH_ACTION"
    else
      DOCKER_GIT_SKIP_POST_PUSH_ACTION=1 "$DOCKER_GIT_POST_PUSH_ACTION"
    fi
  fi
}

subcommand=""
if subcommand="$(docker_git_git_subcommand "$@")" && [[ "$subcommand" == "push" ]]; then
  if "$DOCKER_GIT_REAL_GIT_BIN" "$@"; then
    status=0
  else
    status=$?
  fi

  if [[ "$status" -eq 0 ]] && ! docker_git_git_push_is_dry_run "$@"; then
    docker_git_post_push_action "$@" || status=$?
  fi

  exit "$status"
fi

exec "$DOCKER_GIT_REAL_GIT_BIN" "$@"
EOF
  sed -i "s#__DOCKER_GIT_REAL_BIN__#$GIT_REAL_BIN#g" "$GIT_WRAPPER_BIN" || true
  chmod 0755 "$GIT_WRAPPER_BIN" || true
fi`

export const renderEntrypointGitPostPushWrapperInstall = (): string => entrypointGitPostPushWrapperInstall
