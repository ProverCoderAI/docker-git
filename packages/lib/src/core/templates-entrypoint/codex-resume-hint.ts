import type { TemplateConfig } from "../domain.js"

const escapeForDoubleQuotes = (value: string): string => {
  const backslash = String.fromCodePoint(92)
  return value
    .replaceAll(backslash, `${backslash}${backslash}`)
    .replaceAll(String.fromCodePoint(34), `${backslash}${String.fromCodePoint(34)}`)
}

const entrypointCodexResumeHintTemplate = `# Ensure codex resume hint is shown for interactive shells
CODEX_HINT_PATH="/etc/profile.d/zz-codex-resume.sh"
if [[ ! -s "$CODEX_HINT_PATH" ]]; then
  cat <<'EOF' > "$CODEX_HINT_PATH"
docker_git_workspace_context_line() {
  REPO_REF_VALUE="\${REPO_REF:-__REPO_REF_DEFAULT__}"
  REPO_URL_VALUE="\${REPO_URL:-__REPO_URL_DEFAULT__}"

  if [[ "$REPO_REF_VALUE" == issue-* ]]; then
    ISSUE_ID_VALUE="$(printf "%s" "$REPO_REF_VALUE" | sed -E 's#^issue-##')"
    ISSUE_URL_VALUE=""
    if [[ "$REPO_URL_VALUE" == https://github.com/* ]]; then
      ISSUE_REPO_VALUE="$(printf "%s" "$REPO_URL_VALUE" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
      if [[ -n "$ISSUE_REPO_VALUE" ]]; then
        ISSUE_URL_VALUE="https://github.com/$ISSUE_REPO_VALUE/issues/$ISSUE_ID_VALUE"
      fi
    fi
    if [[ -n "$ISSUE_URL_VALUE" ]]; then
      printf "%s\n" "Контекст workspace: issue #$ISSUE_ID_VALUE ($ISSUE_URL_VALUE)"
    else
      printf "%s\n" "Контекст workspace: issue #$ISSUE_ID_VALUE"
    fi
    return
  fi

  if [[ "$REPO_REF_VALUE" == refs/pull/*/head ]]; then
    PR_ID_VALUE="$(printf "%s" "$REPO_REF_VALUE" | sed -nE 's#^refs/pull/([0-9]+)/head$#\\1#p')"
    PR_URL_VALUE=""
    if [[ "$REPO_URL_VALUE" == https://github.com/* && -n "$PR_ID_VALUE" ]]; then
      PR_REPO_VALUE="$(printf "%s" "$REPO_URL_VALUE" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
      if [[ -n "$PR_REPO_VALUE" ]]; then
        PR_URL_VALUE="https://github.com/$PR_REPO_VALUE/pull/$PR_ID_VALUE"
      fi
    fi
    if [[ -n "$PR_ID_VALUE" && -n "$PR_URL_VALUE" ]]; then
      printf "%s\n" "Контекст workspace: PR #$PR_ID_VALUE ($PR_URL_VALUE)"
    elif [[ -n "$PR_ID_VALUE" ]]; then
      printf "%s\n" "Контекст workspace: PR #$PR_ID_VALUE"
    elif [[ -n "$REPO_REF_VALUE" ]]; then
      printf "%s\n" "Контекст workspace: pull request ($REPO_REF_VALUE)"
    fi
    return
  fi

  if [[ -n "$REPO_URL_VALUE" ]]; then
    printf "%s\n" "Контекст workspace: $REPO_URL_VALUE"
  fi
}

docker_git_print_codex_resume_hint() {
  if [ -z "\${CODEX_RESUME_HINT_SHOWN-}" ]; then
    DOCKER_GIT_CONTEXT_LINE="$(docker_git_workspace_context_line)"
    if [[ -n "$DOCKER_GIT_CONTEXT_LINE" ]]; then
      echo "$DOCKER_GIT_CONTEXT_LINE"
    fi
    echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
    export CODEX_RESUME_HINT_SHOWN=1
  fi
}

if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      docker_git_print_codex_resume_hint
      ;;
  esac
fi
if [ -n "$ZSH_VERSION" ]; then
  if [[ "$-" == *i* ]]; then
    docker_git_print_codex_resume_hint
  fi
fi
EOF
  chmod 0644 "$CODEX_HINT_PATH"
fi
if ! grep -q "zz-codex-resume.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then . /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/bash.bashrc
fi
if [[ -s /etc/zsh/zshrc ]] && ! grep -q "zz-codex-resume.sh" /etc/zsh/zshrc 2>/dev/null; then
  printf "%s\\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then source /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/zsh/zshrc
fi`

// PURITY: CORE
// INVARIANT: rendered output contains shell-escaped repo ref and url placeholders
// COMPLEXITY: O(1)
export const renderEntrypointCodexResumeHint = (config: TemplateConfig): string =>
  entrypointCodexResumeHintTemplate
    .replaceAll("__REPO_REF_DEFAULT__", escapeForDoubleQuotes(config.repoRef))
    .replaceAll("__REPO_URL_DEFAULT__", escapeForDoubleQuotes(config.repoUrl))
