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
web_search_request = true
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

export const renderEntrypointAgentsNotice = (config: TemplateConfig): string =>
  String.raw`# Ensure global AGENTS.md exists for container context
AGENTS_PATH="${config.codexHome}/AGENTS.md"
LEGACY_AGENTS_PATH="/home/${config.sshUser}/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): ${config.targetDir}"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
if [[ ! -f "$AGENTS_PATH" ]]; then
  cat <<'AGENTS_EOF' > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): ${config.targetDir}
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
AGENTS_EOF
  chown 1000:1000 "$AGENTS_PATH" || true
fi
if [[ -f "$AGENTS_PATH" ]]; then
  if grep -q "^Рабочая папка проекта (git clone):" "$AGENTS_PATH"; then
    sed -i "s|^Рабочая папка проекта (git clone):.*$|$PROJECT_LINE|" "$AGENTS_PATH"
  else
    printf "%s\n" "$PROJECT_LINE" >> "$AGENTS_PATH"
  fi
  if grep -q "^Доступ к интернету:" "$AGENTS_PATH"; then
    sed -i "s|^Доступ к интернету:.*$|$INTERNET_LINE|" "$AGENTS_PATH"
  else
    printf "%s\n" "$INTERNET_LINE" >> "$AGENTS_PATH"
  fi
fi
if [[ -f "$LEGACY_AGENTS_PATH" && -f "$AGENTS_PATH" ]]; then
  LEGACY_SUM="$(cksum "$LEGACY_AGENTS_PATH" 2>/dev/null | awk '{print $1 \":\" $2}')"
  CODEX_SUM="$(cksum "$AGENTS_PATH" 2>/dev/null | awk '{print $1 \":\" $2}')"
  if [[ -n "$LEGACY_SUM" && "$LEGACY_SUM" == "$CODEX_SUM" ]]; then
    rm -f "$LEGACY_AGENTS_PATH"
  fi
fi`
