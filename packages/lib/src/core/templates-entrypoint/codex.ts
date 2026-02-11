import type { TemplateConfig } from "../domain.js"

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
  CODEX_SHARED_HOME="${config.codexHome}-shared"
  mkdir -p "$CODEX_SHARED_HOME"
  chown -R 1000:1000 "$CODEX_SHARED_HOME" || true

  AUTH_FILE="${config.codexHome}/auth.json"
  SHARED_AUTH_FILE="$CODEX_SHARED_HOME/auth.json"

  # Guard against a bad bind mount creating a directory at auth.json.
  if [[ -d "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_FILE.bak-$(date +%s)" || true
  fi
  if [[ -e "$AUTH_FILE" && ! -L "$AUTH_FILE" ]]; then
    rm -f "$AUTH_FILE" || true
  fi

  ln -sf "$SHARED_AUTH_FILE" "$AUTH_FILE"
fi`

export const renderEntrypointDockerGitBootstrap = (config: TemplateConfig): string =>
  `# Bootstrap ~/.docker-git for nested docker-git usage inside this container.
DOCKER_GIT_HOME="/home/${config.sshUser}/.docker-git"
DOCKER_GIT_AUTH_DIR="$DOCKER_GIT_HOME/.orch/auth/codex"
DOCKER_GIT_ENV_DIR="$DOCKER_GIT_HOME/.orch/env"
DOCKER_GIT_ENV_GLOBAL="$DOCKER_GIT_ENV_DIR/global.env"
DOCKER_GIT_ENV_PROJECT="$DOCKER_GIT_ENV_DIR/project.env"
DOCKER_GIT_AUTH_KEYS="$DOCKER_GIT_HOME/authorized_keys"

mkdir -p "$DOCKER_GIT_AUTH_DIR" "$DOCKER_GIT_ENV_DIR" "$DOCKER_GIT_HOME/.orch/auth/gh"

if [[ -f "/home/${config.sshUser}/.ssh/authorized_keys" ]]; then
  cp "/home/${config.sshUser}/.ssh/authorized_keys" "$DOCKER_GIT_AUTH_KEYS"
elif [[ -f /authorized_keys ]]; then
  cp /authorized_keys "$DOCKER_GIT_AUTH_KEYS"
fi
if [[ -f "$DOCKER_GIT_AUTH_KEYS" ]]; then
  chmod 600 "$DOCKER_GIT_AUTH_KEYS" || true
fi

if [[ ! -f "$DOCKER_GIT_ENV_GLOBAL" ]]; then
  cat <<'EOF' > "$DOCKER_GIT_ENV_GLOBAL"
# docker-git env
# KEY=value
EOF
fi
if [[ ! -f "$DOCKER_GIT_ENV_PROJECT" ]]; then
  cat <<'EOF' > "$DOCKER_GIT_ENV_PROJECT"
# docker-git project env defaults
CODEX_SHARE_AUTH=1
CODEX_AUTO_UPDATE=1
DOCKER_GIT_ZSH_AUTOSUGGEST=1
DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE=fg=8,italic
DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY=history completion
MCP_PLAYWRIGHT_ISOLATED=1
EOF
fi

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$file" > "$tmp"
  printf "%s=%s\\n" "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}

copy_if_distinct_file() {
  local source="$1"
  local target="$2"
  if [[ ! -f "$source" ]]; then
    return 1
  fi
  local source_real=""
  local target_real=""
  source_real="$(readlink -f "$source" 2>/dev/null || true)"
  target_real="$(readlink -f "$target" 2>/dev/null || true)"
  if [[ -n "$source_real" && -n "$target_real" && "$source_real" == "$target_real" ]]; then
    return 0
  fi
  cp "$source" "$target"
  return 0
}

if [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GH_TOKEN" "$GH_TOKEN"
fi
if [[ -n "$GITHUB_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GITHUB_TOKEN"
elif [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GH_TOKEN"
fi

SOURCE_CODEX_CONFIG="${config.codexHome}/config.toml"
copy_if_distinct_file "$SOURCE_CODEX_CONFIG" "$DOCKER_GIT_AUTH_DIR/config.toml" || true

SOURCE_SHARED_AUTH="${config.codexHome}-shared/auth.json"
SOURCE_LOCAL_AUTH="${config.codexHome}/auth.json"
if [[ -f "$SOURCE_SHARED_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_SHARED_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
elif [[ -f "$SOURCE_LOCAL_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_LOCAL_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi
if [[ -f "$DOCKER_GIT_AUTH_DIR/auth.json" ]]; then
  chmod 600 "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi

chown -R 1000:1000 "$DOCKER_GIT_HOME" || true`

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
model = "gpt-5.3-codex"
model_reasoning_effort = "xhigh"
personality = "pragmatic"

approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

[features]
shell_snapshot = true
collab = true
apps = true
shell_tool = true
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

export const renderEntrypointCodexResumeHint = (): string =>
  `# Ensure codex resume hint is shown for interactive shells
CODEX_HINT_PATH="/etc/profile.d/zz-codex-resume.sh"
if [[ ! -s "$CODEX_HINT_PATH" ]]; then
  cat <<'EOF' > "$CODEX_HINT_PATH"
if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      if [ -z "\${CODEX_RESUME_HINT_SHOWN-}" ]; then
        echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
        export CODEX_RESUME_HINT_SHOWN=1
      fi
      ;;
  esac
fi
if [ -n "$ZSH_VERSION" ]; then
  if [[ "$-" == *i* ]]; then
    if [[ -z "\${CODEX_RESUME_HINT_SHOWN-}" ]]; then
      echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
      export CODEX_RESUME_HINT_SHOWN=1
    fi
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

const entrypointAgentsNoticeTemplate = String.raw`# Ensure global AGENTS.md exists for container context
AGENTS_PATH="__CODEX_HOME__/AGENTS.md"
LEGACY_AGENTS_PATH="/home/__SSH_USER__/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): __TARGET_DIR__"
WORKSPACES_LINE="Доступные workspace пути: __TARGET_DIR__"
WORKSPACE_INFO_LINE="Контекст workspace: repository"
FOCUS_LINE="Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__"
ISSUE_AGENTS_HINT_LINE="Issue AGENTS.md: n/a"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
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
  ISSUE_AGENTS_HINT_LINE="Issue AGENTS.md: __TARGET_DIR__/AGENTS.md"
elif [[ "$REPO_REF" == refs/pull/*/head ]]; then
  PR_ID="$(printf "%s" "$REPO_REF" | sed -E 's#^refs/pull/([0-9]+)/head$#\1#')"
  if [[ -n "$PR_ID" ]]; then
    WORKSPACE_INFO_LINE="Контекст workspace: PR #$PR_ID"
  else
    WORKSPACE_INFO_LINE="Контекст workspace: pull request ($REPO_REF)"
  fi
fi
if [[ ! -f "$AGENTS_PATH" ]]; then
  MANAGED_START="<!-- docker-git:managed:start -->"
  MANAGED_END="<!-- docker-git:managed:end -->"
  MANAGED_BLOCK="$(cat <<EOF
$MANAGED_START
$PROJECT_LINE
$WORKSPACES_LINE
$WORKSPACE_INFO_LINE
$FOCUS_LINE
$ISSUE_AGENTS_HINT_LINE
$INTERNET_LINE
$MANAGED_END
EOF
)"
  cat <<EOF > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
$MANAGED_BLOCK
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
EOF
  chown 1000:1000 "$AGENTS_PATH" || true
fi
if [[ -f "$AGENTS_PATH" ]]; then
  MANAGED_START="<!-- docker-git:managed:start -->"
  MANAGED_END="<!-- docker-git:managed:end -->"
  MANAGED_BLOCK="$(cat <<EOF
$MANAGED_START
$PROJECT_LINE
$WORKSPACES_LINE
$WORKSPACE_INFO_LINE
$FOCUS_LINE
$ISSUE_AGENTS_HINT_LINE
$INTERNET_LINE
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
  entrypointAgentsNoticeTemplate
    .replaceAll("__CODEX_HOME__", config.codexHome)
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll("__TARGET_DIR__", config.targetDir)
