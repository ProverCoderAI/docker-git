/* jscpd:ignore-start */
import type { TemplateConfig } from "../domain.js"

const entrypointAgentsNoticeTemplate = String.raw`# Ensure global AGENTS.md exists for container context
AGENTS_PATH="__CODEX_HOME__/AGENTS.md"
LEGACY_AGENTS_PATH="/home/__SSH_USER__/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): __TARGET_DIR__"
WORKSPACES_LINE="Доступные workspace пути: __TARGET_DIR__"
WORKSPACE_INFO_LINE="Контекст workspace: repository"
FOCUS_LINE="Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
SUBAGENTS_LINE="Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю."
if [[ "$REPO_REF" == issue-* ]]; then
  ISSUE_ID="$(printf "%s" "$REPO_REF" | sed -E 's#^issue-##')"
  ISSUE_URL=""
  if [[ "$REPO_URL" == https://github.com/* ]]; then
    ISSUE_REPO="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
    if [[ -n "$ISSUE_REPO" ]]; then
      ISSUE_URL="https://github.com/$ISSUE_REPO/issues/$ISSUE_ID"
    fi
  fi
  if [[ -n "$ISSUE_URL" ]]; then
    WORKSPACE_INFO_LINE="Контекст workspace: issue #$ISSUE_ID ($ISSUE_URL)"
  else
    WORKSPACE_INFO_LINE="Контекст workspace: issue #$ISSUE_ID"
  fi
elif [[ "$REPO_REF" == refs/pull/*/head ]]; then
  PR_ID="$(printf "%s" "$REPO_REF" | sed -nE 's#^refs/pull/([0-9]+)/head$#\1#p')"
  PR_URL=""
  if [[ "$REPO_URL" == https://github.com/* && -n "$PR_ID" ]]; then
    PR_REPO="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
    if [[ -n "$PR_REPO" ]]; then
      PR_URL="https://github.com/$PR_REPO/pull/$PR_ID"
    fi
  fi
  if [[ -n "$PR_ID" && -n "$PR_URL" ]]; then
    WORKSPACE_INFO_LINE="Контекст workspace: PR #$PR_ID ($PR_URL)"
  elif [[ -n "$PR_ID" ]]; then
    WORKSPACE_INFO_LINE="Контекст workspace: PR #$PR_ID"
  else
    WORKSPACE_INFO_LINE="Контекст workspace: pull request ($REPO_REF)"
  fi
fi
MANAGED_START="<!-- docker-git:managed:start -->"
MANAGED_END="<!-- docker-git:managed:end -->"
if [[ ! -f "$AGENTS_PATH" ]]; then
  MANAGED_BLOCK="$(cat <<EOF
$MANAGED_START
$PROJECT_LINE
$WORKSPACES_LINE
$WORKSPACE_INFO_LINE
$FOCUS_LINE
$INTERNET_LINE
$SUBAGENTS_LINE
$MANAGED_END
EOF
)"
  cat <<EOF > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, bun, codex, opencode, oh-my-opencode, sshpass, git, node и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
$MANAGED_BLOCK
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
EOF
  chown 1000:1000 "$AGENTS_PATH" || true
fi
if [[ -f "$AGENTS_PATH" ]]; then
  MANAGED_BLOCK="$(cat <<EOF
$MANAGED_START
$PROJECT_LINE
$WORKSPACES_LINE
$WORKSPACE_INFO_LINE
$FOCUS_LINE
$INTERNET_LINE
$SUBAGENTS_LINE
$MANAGED_END
EOF
)"
  TMP_AGENTS_PATH="$(mktemp)"
  if grep -qF "$MANAGED_START" "$AGENTS_PATH" && grep -qF "$MANAGED_END" "$AGENTS_PATH"; then
    awk -v start="$MANAGED_START" -v end="$MANAGED_END" -v repl="$MANAGED_BLOCK" '
      BEGIN { in_block = 0 }
      $0 == start { print repl; in_block = 1; next }
      $0 == end { in_block = 0; next }
      in_block == 0 { print }
    ' "$AGENTS_PATH" > "$TMP_AGENTS_PATH"
  else
    sed \
      -e '/^Рабочая папка проекта (git clone):/d' \
      -e '/^Доступные workspace пути:/d' \
      -e '/^Контекст workspace:/d' \
      -e '/^Фокус задачи:/d' \
      -e '/^Issue AGENTS.md:/d' \
      -e '/^Доступ к интернету:/d' \
      -e '/^Для решения задач обязательно используй subagents[.]/d' \
      "$AGENTS_PATH" > "$TMP_AGENTS_PATH"
    if [[ -s "$TMP_AGENTS_PATH" ]]; then
      printf "\n" >> "$TMP_AGENTS_PATH"
    fi
    printf "%s\n" "$MANAGED_BLOCK" >> "$TMP_AGENTS_PATH"
  fi
  mv "$TMP_AGENTS_PATH" "$AGENTS_PATH"
  chown 1000:1000 "$AGENTS_PATH" || true
fi
if [[ -f "$LEGACY_AGENTS_PATH" && -f "$AGENTS_PATH" ]]; then
  LEGACY_SUM="$(cksum "$LEGACY_AGENTS_PATH" 2>/dev/null | awk '{print $1 \":\" $2}')"
  CODEX_SUM="$(cksum "$AGENTS_PATH" 2>/dev/null | awk '{print $1 \":\" $2}')"
  if [[ -n "$LEGACY_SUM" && "$LEGACY_SUM" == "$CODEX_SUM" ]]; then
    rm -f "$LEGACY_AGENTS_PATH"
  fi
fi`

export const renderEntrypointAgentsNotice = (config: TemplateConfig): string =>
  entrypointAgentsNoticeTemplate.replaceAll("__CODEX_HOME__", config.codexHome).replaceAll(
    "__SSH_USER__",
    config.sshUser
  )
    .replaceAll("__TARGET_DIR__", config.targetDir)
/* jscpd:ignore-end */
