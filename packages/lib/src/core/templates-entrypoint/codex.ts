import type { TemplateConfig } from "../domain.js"
import { systemPromptBehavior } from "./system-prompt-content.js"

export { renderEntrypointCodexResumeHint } from "./codex-resume-hint.js"

export const renderEntrypointCodexHome = (config: TemplateConfig): string =>
  `# Ensure Codex home exists if mounted
mkdir -p ${config.codexHome}
chown -R 1000:1000 ${config.codexHome}

# Ensure home ownership matches the dev UID/GID (volumes may be stale)
HOME_OWNER="$(stat -c "%u:%g" /home/${config.sshUser} 2>/dev/null || echo "")"
if [[ "$HOME_OWNER" != "1000:1000" ]]; then
  chown -R 1000:1000 /home/${config.sshUser} || true
fi`

export const renderEntrypointCodexSharedAuth = (config: TemplateConfig): string =>
  `# Share Codex auth.json across projects (avoids refresh_token_reused)
CODEX_SHARE_AUTH="\${CODEX_SHARE_AUTH:-1}"
if [[ "$CODEX_SHARE_AUTH" == "1" ]]; then
  CODEX_LABEL_RAW="$CODEX_AUTH_LABEL"
  if [[ -z "$CODEX_LABEL_RAW" ]]; then CODEX_LABEL_RAW="default"; fi
  CODEX_LABEL_NORM="$(printf "%s" "$CODEX_LABEL_RAW" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  if [[ -z "$CODEX_LABEL_NORM" ]]; then CODEX_LABEL_NORM="default"; fi
  CODEX_AUTH_LABEL="$CODEX_LABEL_NORM"
  CODEX_SHARED_HOME="${config.codexHome}-shared"
  mkdir -p "$CODEX_SHARED_HOME"
  chown -R 1000:1000 "$CODEX_SHARED_HOME" || true
  AUTH_FILE="${config.codexHome}/auth.json"
  SHARED_AUTH_FILE="$CODEX_SHARED_HOME/auth.json"
  if [[ "$CODEX_LABEL_NORM" != "default" ]]; then
    SHARED_AUTH_FILE="$CODEX_SHARED_HOME/$CODEX_LABEL_NORM/auth.json"
    mkdir -p "$(dirname "$SHARED_AUTH_FILE")"
  fi
  # Guard against a bad bind mount creating a directory at auth.json.
  if [[ -d "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_FILE.bak-$(date +%s)" || true
  fi
  if [[ -e "$AUTH_FILE" && ! -L "$AUTH_FILE" ]]; then
    rm -f "$AUTH_FILE" || true
  fi
  ln -sf "$SHARED_AUTH_FILE" "$AUTH_FILE"
  docker_git_upsert_ssh_env "CODEX_AUTH_LABEL" "$CODEX_AUTH_LABEL"
fi`

const entrypointMcpPlaywrightTemplate = String.raw`# Optional: configure Playwright MCP for Codex (browser automation)
CODEX_CONFIG_FILE="__CODEX_HOME__/config.toml"

# Keep config.toml consistent with the container build.
# If Playwright MCP is disabled for this container, remove the block so Codex
# doesn't try (and fail) to spawn docker-git-playwright-mcp.
if [[ "$MCP_PLAYWRIGHT_ENABLE" != "1" ]]; then
  if [[ -f "$CODEX_CONFIG_FILE" ]] && grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Playwright MCP/ { next }
      /^\[mcp_servers[.]playwright([.]|\])/ { skip=1; next }
      skip==1 && /^\[/ { skip=0 }
      skip==0 { print }
    ' "$CODEX_CONFIG_FILE" > "$CODEX_CONFIG_FILE.tmp"
    mv "$CODEX_CONFIG_FILE.tmp" "$CODEX_CONFIG_FILE"
  fi
else
  if [[ ! -f "$CODEX_CONFIG_FILE" ]]; then
    mkdir -p "$(dirname "$CODEX_CONFIG_FILE")" || true
    cat <<'EOF' > "$CODEX_CONFIG_FILE"
# docker-git codex config
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
plan_mode_reasoning_effort = "xhigh"
personality = "pragmatic"

approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

[features]
shell_snapshot = true
multi_agent = true
apps = true
shell_tool = true

[profiles.longcontx]
model = "gpt-5.4"
model_context_window = 1050000
model_auto_compact_token_limit = 945000
model_reasoning_effort = "xhigh"
plan_mode_reasoning_effort = "xhigh"
EOF
    chown 1000:1000 "$CODEX_CONFIG_FILE" || true
  fi

  if [[ -z "$MCP_PLAYWRIGHT_CDP_ENDPOINT" ]]; then
    MCP_PLAYWRIGHT_CDP_ENDPOINT="http://__SERVICE_NAME__-browser:9223"
  fi

  # Replace the docker-git Playwright block to allow upgrades via --force without manual edits.
  if grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Playwright MCP/ { next }
      /^\[mcp_servers[.]playwright([.]|\])/ { skip=1; next }
      skip==1 && /^\[/ { skip=0 }
      skip==0 { print }
    ' "$CODEX_CONFIG_FILE" > "$CODEX_CONFIG_FILE.tmp"
    mv "$CODEX_CONFIG_FILE.tmp" "$CODEX_CONFIG_FILE"
  fi

  cat <<EOF >> "$CODEX_CONFIG_FILE"

# docker-git: Playwright MCP (connects to Chromium via CDP)
[mcp_servers.playwright]
command = "docker-git-playwright-mcp"
args = []
EOF
fi`

export const renderEntrypointMcpPlaywright = (config: TemplateConfig): string =>
  entrypointMcpPlaywrightTemplate
    .replaceAll("__CODEX_HOME__", config.codexHome)
    .replaceAll("__SERVICE_NAME__", config.serviceName)

const entrypointAgentsNoticeTemplate = String.raw`# Ensure global AGENTS.md exists for container context
AGENTS_PATH="__CODEX_HOME__/AGENTS.md"
LEGACY_AGENTS_PATH="/home/__SSH_USER__/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): __TARGET_DIR__"
WORKSPACES_LINE="Доступные workspace пути: __TARGET_DIR__"
WORKSPACE_INFO_LINE="Контекст workspace: repository"
FOCUS_LINE="Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
BEHAVIOR_BLOCK="__SYSTEM_PROMPT_BEHAVIOR__"
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
$BEHAVIOR_BLOCK
$MANAGED_END
EOF
)"
  cat <<EOF > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, opencode, oh-my-opencode, sshpass, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
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
$BEHAVIOR_BLOCK
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
  ).replaceAll("__TARGET_DIR__", config.targetDir)
    .replaceAll("__SYSTEM_PROMPT_BEHAVIOR__", systemPromptBehavior)
