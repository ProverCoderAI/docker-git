import type { TemplateConfig } from "../domain.js"
import { systemPromptBehavior } from "./system-prompt-content.js"

const entrypointClaudeGlobalPromptTemplate = String
  .raw`# Claude Code: managed global memory (CLAUDE.md is auto-loaded by Claude Code)
CLAUDE_GLOBAL_PROMPT_FILE="/home/__SSH_USER__/.claude/CLAUDE.md"
CLAUDE_AUTO_SYSTEM_PROMPT="${"$"}{CLAUDE_AUTO_SYSTEM_PROMPT:-1}"
CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: repository"
REPO_REF_VALUE="${"$"}{REPO_REF:-__REPO_REF_DEFAULT__}"
REPO_URL_VALUE="${"$"}{REPO_URL:-__REPO_URL_DEFAULT__}"

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
    CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID_VALUE ($ISSUE_URL_VALUE)"
  else
    CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID_VALUE"
  fi
elif [[ "$REPO_REF_VALUE" == refs/pull/*/head ]]; then
  PR_ID_VALUE="$(printf "%s" "$REPO_REF_VALUE" | sed -nE 's#^refs/pull/([0-9]+)/head$#\1#p')"
  PR_URL_VALUE=""
  if [[ "$REPO_URL_VALUE" == https://github.com/* && -n "$PR_ID_VALUE" ]]; then
    PR_REPO_VALUE="$(printf "%s" "$REPO_URL_VALUE" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
    if [[ -n "$PR_REPO_VALUE" ]]; then
      PR_URL_VALUE="https://github.com/$PR_REPO_VALUE/pull/$PR_ID_VALUE"
    fi
  fi
  if [[ -n "$PR_ID_VALUE" && -n "$PR_URL_VALUE" ]]; then
    CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID_VALUE ($PR_URL_VALUE)"
  elif [[ -n "$PR_ID_VALUE" ]]; then
    CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID_VALUE"
  else
    CLAUDE_WORKSPACE_CONTEXT="Контекст workspace: pull request ($REPO_REF_VALUE)"
  fi
fi

if [[ "$CLAUDE_AUTO_SYSTEM_PROMPT" == "1" ]]; then
  mkdir -p "$(dirname "$CLAUDE_GLOBAL_PROMPT_FILE")"
  chown 1000:1000 "$(dirname "$CLAUDE_GLOBAL_PROMPT_FILE")" 2>/dev/null || true
  if [[ ! -f "$CLAUDE_GLOBAL_PROMPT_FILE" ]] || grep -q "^<!-- docker-git-managed:claude-md -->$" "$CLAUDE_GLOBAL_PROMPT_FILE"; then
    cat <<EOF > "$CLAUDE_GLOBAL_PROMPT_FILE"
<!-- docker-git-managed:claude-md -->
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, opencode, oh-my-opencode, sshpass, claude, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): __TARGET_DIR__
Доступные workspace пути: __TARGET_DIR__
$CLAUDE_WORKSPACE_CONTEXT
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
__SYSTEM_PROMPT_BEHAVIOR__
Если ты видишь файлы AGENTS.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.
<!-- /docker-git-managed:claude-md -->
EOF
    chmod 0644 "$CLAUDE_GLOBAL_PROMPT_FILE" || true
    chown 1000:1000 "$CLAUDE_GLOBAL_PROMPT_FILE" || true
  fi
fi

export CLAUDE_AUTO_SYSTEM_PROMPT`

const escapeForDoubleQuotes = (value: string): string => {
  const backslash = String.fromCodePoint(92)
  const quote = String.fromCodePoint(34)
  const escapedBackslash = `${backslash}${backslash}`
  const escapedQuote = `${backslash}${quote}`
  return value
    .replaceAll(backslash, escapedBackslash)
    .replaceAll(quote, escapedQuote)
}

export const renderClaudeGlobalPromptSetup = (config: TemplateConfig): string =>
  entrypointClaudeGlobalPromptTemplate
    .replaceAll("__TARGET_DIR__", config.targetDir)
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll("__REPO_REF_DEFAULT__", escapeForDoubleQuotes(config.repoRef))
    .replaceAll("__REPO_URL_DEFAULT__", escapeForDoubleQuotes(config.repoUrl))
    .replaceAll("__SYSTEM_PROMPT_BEHAVIOR__", systemPromptBehavior)

export const renderClaudeWrapperSetup = (): string =>
  String.raw`CLAUDE_WRAPPER_BIN="/usr/local/bin/claude"
if command -v claude >/dev/null 2>&1; then
  CURRENT_CLAUDE_BIN="$(command -v claude)"
  CLAUDE_REAL_DIR="$(dirname "$CURRENT_CLAUDE_BIN")"
  CLAUDE_REAL_BIN="$CLAUDE_REAL_DIR/.docker-git-claude-real"

  # If a wrapper already exists but points to a missing real binary, recover from /usr/bin.
  if [[ "$CURRENT_CLAUDE_BIN" == "$CLAUDE_WRAPPER_BIN" && ! -e "$CLAUDE_REAL_BIN" && -x "/usr/bin/claude" ]]; then
    CURRENT_CLAUDE_BIN="/usr/bin/claude"
    CLAUDE_REAL_DIR="/usr/bin"
    CLAUDE_REAL_BIN="$CLAUDE_REAL_DIR/.docker-git-claude-real"
  fi

  # Keep the "real" binary in the same directory as the original command to preserve relative symlinks.
  if [[ "$CURRENT_CLAUDE_BIN" != "$CLAUDE_REAL_BIN" && ! -e "$CLAUDE_REAL_BIN" ]]; then
    mv "$CURRENT_CLAUDE_BIN" "$CLAUDE_REAL_BIN"
  fi
  if [[ -e "$CLAUDE_REAL_BIN" ]]; then
    cat <<'EOF' > "$CLAUDE_WRAPPER_BIN"
#!/usr/bin/env bash
set -euo pipefail

CLAUDE_REAL_BIN="__CLAUDE_REAL_BIN__"
CLAUDE_CONFIG_DIR="${"$"}{CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CLAUDE_TOKEN_FILE="$CLAUDE_CONFIG_DIR/.oauth-token"

if [[ -f "$CLAUDE_TOKEN_FILE" ]]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < "$CLAUDE_TOKEN_FILE")"
  export CLAUDE_CODE_OAUTH_TOKEN
else
  unset CLAUDE_CODE_OAUTH_TOKEN || true
fi

exec "$CLAUDE_REAL_BIN" "$@"
EOF
    sed -i "s#__CLAUDE_REAL_BIN__#$CLAUDE_REAL_BIN#g" "$CLAUDE_WRAPPER_BIN" || true
    chmod 0755 "$CLAUDE_WRAPPER_BIN" || true
  fi
fi`
