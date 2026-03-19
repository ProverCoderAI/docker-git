import type { TemplateConfig } from "../domain.js"

// CHANGE: add Gemini CLI entrypoint configuration
// WHY: enable Gemini CLI in Docker with automated auth, trust settings and MCP
// REF: issue-146
// SOURCE: https://github.com/google-gemini/gemini-cli
// FORMAT THEOREM: renderEntrypointGeminiConfig(config) -> valid_bash_script
// PURITY: CORE
// INVARIANT: configurations are isolated by GEMINI_AUTH_LABEL
// COMPLEXITY: O(1)

const geminiAuthRootContainerPath = (sshUser: string): string => `/home/${sshUser}/.docker-git/.orch/auth/gemini`

const geminiAuthConfigTemplate = String
  .raw`# Gemini CLI: keep ~/.gemini as a real home directory while sharing auth files from ~/.docker-git/.orch/auth/gemini
GEMINI_LABEL_RAW="$GEMINI_AUTH_LABEL"
if [[ -z "$GEMINI_LABEL_RAW" ]]; then
  GEMINI_LABEL_RAW="default"
fi

GEMINI_LABEL_NORM="$(printf "%s" "$GEMINI_LABEL_RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "$GEMINI_LABEL_NORM" ]]; then
  GEMINI_LABEL_NORM="default"
fi

GEMINI_AUTH_ROOT="__GEMINI_AUTH_ROOT__"
export GEMINI_CONFIG_DIR="$GEMINI_AUTH_ROOT/$GEMINI_LABEL_NORM"

mkdir -p "$GEMINI_CONFIG_DIR" || true
GEMINI_HOME_DIR="__GEMINI_HOME_DIR__"
mkdir -p "$GEMINI_HOME_DIR" || true
GEMINI_SHARED_HOME_DIR="$GEMINI_CONFIG_DIR/.gemini"
mkdir -p "$GEMINI_SHARED_HOME_DIR" || true

docker_git_link_gemini_file() {
  local source_path="$1"
  local link_path="$2"

  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    if [[ -f "$link_path" && ! -e "$source_path" ]]; then
      cp "$link_path" "$source_path" || true
      chmod 0600 "$source_path" || true
    fi
    return 0
  fi

  ln -sfn "$source_path" "$link_path" || true
}

docker_git_prepare_gemini_home_dir() {
  if [[ -L "$GEMINI_HOME_DIR" ]]; then
    local previous_target
    previous_target="$(readlink -f "$GEMINI_HOME_DIR" || true)"
    rm -f "$GEMINI_HOME_DIR" || true
    mkdir -p "$GEMINI_HOME_DIR" || true
    if [[ -n "$previous_target" && -d "$previous_target" ]]; then
      cp -a "$previous_target"/. "$GEMINI_HOME_DIR"/ 2>/dev/null || true
    fi
    return 0
  fi

  mkdir -p "$GEMINI_HOME_DIR" || true
}

docker_git_prepare_gemini_home_dir

# Link .api-key and .env from central auth storage to container home
docker_git_link_gemini_file "$GEMINI_CONFIG_DIR/.api-key" "$GEMINI_HOME_DIR/.api-key"
docker_git_link_gemini_file "$GEMINI_CONFIG_DIR/.env" "$GEMINI_HOME_DIR/.env"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/oauth_creds.json" "$GEMINI_HOME_DIR/oauth_creds.json"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/oauth-tokens.json" "$GEMINI_HOME_DIR/oauth-tokens.json"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/credentials.json" "$GEMINI_HOME_DIR/credentials.json"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/application_default_credentials.json" "$GEMINI_HOME_DIR/application_default_credentials.json"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/google_accounts.json" "$GEMINI_HOME_DIR/google_accounts.json"
docker_git_link_gemini_file "$GEMINI_SHARED_HOME_DIR/projects.json" "$GEMINI_HOME_DIR/projects.json"

# Ensure gemini YOLO wrapper exists
GEMINI_REAL_BIN="$(command -v gemini || echo "/usr/local/bin/gemini")"
GEMINI_WRAPPER_BIN="/usr/local/bin/gemini-wrapper"
if [[ -f "$GEMINI_REAL_BIN" && "$GEMINI_REAL_BIN" != "$GEMINI_WRAPPER_BIN" ]]; then
  if [[ ! -f "$GEMINI_WRAPPER_BIN" ]]; then
    cat <<'EOF' > "$GEMINI_WRAPPER_BIN"
#!/usr/bin/env bash
GEMINI_ORIGINAL_BIN="__GEMINI_REAL_BIN__"
exec "$GEMINI_ORIGINAL_BIN" --yolo "$@"
EOF
    sed -i "s#__GEMINI_REAL_BIN__#$GEMINI_REAL_BIN#g" "$GEMINI_WRAPPER_BIN" || true
    chmod 0755 "$GEMINI_WRAPPER_BIN" || true
    # Create an alias or symlink if needed, but here we just ensure it exists
  fi
fi

docker_git_refresh_gemini_env() {
  # If .api-key exists, export it as GEMINI_API_KEY
  if [[ -f "$GEMINI_HOME_DIR/.api-key" ]]; then
    export GEMINI_API_KEY="$(cat "$GEMINI_HOME_DIR/.api-key" | tr -d '\r\n')"
  elif [[ -f "$GEMINI_HOME_DIR/.env" ]]; then
    # Parse GEMINI_API_KEY from .env
    API_KEY="$(grep "^GEMINI_API_KEY=" "$GEMINI_HOME_DIR/.env" | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//")"
    if [[ -n "$API_KEY" ]]; then
      export GEMINI_API_KEY="$API_KEY"
    fi
  fi
}

docker_git_refresh_gemini_env`

const renderGeminiAuthConfig = (config: TemplateConfig): string =>
  geminiAuthConfigTemplate
    .replaceAll("__GEMINI_AUTH_ROOT__", geminiAuthRootContainerPath(config.sshUser))
    .replaceAll("__GEMINI_HOME_DIR__", config.geminiHome)

const geminiSettingsJsonTemplate = `{
  "model": {
    "name": "gemini-3.1-pro-preview",
    "compressionThreshold": 0.9,
    "disableLoopDetection": true
  },
  "modelConfigs": {
    "customAliases": {
      "yolo-ultra": {
        "modelConfig": {
          "model": "gemini-3.1-pro-preview",
          "generateContentConfig": {
            "tools": [
              {
                "googleSearch": {}
              },
              {
                "urlContext": {}
              }
            ]
          }
        }
      }
    }
  },
  "general": {
    "defaultApprovalMode": "auto_edit"
  },
  "tools": {
    "allowed": [
      "run_shell_command",
      "write_file",
      "googleSearch",
      "urlContext"
    ]
  },
  "sandbox": {
    "enabled": false
  },
  "security": {
    "folderTrust": {
      "enabled": false
    },
    "auth": {
      "selectedType": "oauth-personal"
    },
    "disableYoloMode": false
  },
  "mcpServers": {
    "playwright": {
      "command": "docker-git-playwright-mcp",
      "args": [],
      "trust": true
    }
  }
}`

const renderGeminiPermissionSettingsConfig = (config: TemplateConfig): string =>
  String.raw`# Gemini CLI: keep trust settings in sync with docker-git defaults
GEMINI_SETTINGS_DIR="${config.geminiHome}"
GEMINI_TRUST_SETTINGS_FILE="$GEMINI_SETTINGS_DIR/trustedFolders.json"
GEMINI_CONFIG_SETTINGS_FILE="$GEMINI_SETTINGS_DIR/settings.json"

# Wait for symlink to be established by the auth config step
mkdir -p "$GEMINI_SETTINGS_DIR" || true

# Disable folder trust prompt and enable auto-approval in settings.json
cat <<'EOF' > "$GEMINI_CONFIG_SETTINGS_FILE"
${geminiSettingsJsonTemplate}
EOF

# Pre-trust important directories in trustedFolders.json
# Use flat mapping as required by recent Gemini CLI versions
cat <<'EOF' > "$GEMINI_TRUST_SETTINGS_FILE"
{
  "/": "TRUST_FOLDER",
  "${config.geminiHome}": "TRUST_FOLDER",
  "${config.targetDir}": "TRUST_FOLDER"
}
EOF

chown -R 1000:1000 "$GEMINI_SETTINGS_DIR" || true
chmod 0600 "$GEMINI_TRUST_SETTINGS_FILE" "$GEMINI_CONFIG_SETTINGS_FILE" 2>/dev/null || true`

const renderGeminiSudoConfig = (config: TemplateConfig): string =>
  String.raw`# Gemini CLI: allow passwordless sudo for agent tasks
if [[ -d /etc/sudoers.d ]]; then
  echo "${config.sshUser} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/gemini-agent
  chmod 0440 /etc/sudoers.d/gemini-agent
fi`

const renderGeminiMcpPlaywrightConfig = (_config: TemplateConfig): string =>
  String.raw`# Gemini CLI: keep Playwright MCP config in sync (TODO: Gemini CLI MCP integration format)
# For now, Gemini CLI uses MCP via ~/.gemini/settings.json or command line.
# We'll ensure it has the same Playwright capability as Claude/Codex once format is confirmed.`

const renderGeminiProfileSetup = (config: TemplateConfig): string =>
  String.raw`GEMINI_PROFILE="/etc/profile.d/gemini-config.sh"
printf "export GEMINI_AUTH_LABEL=%q\n" "$GEMINI_AUTH_LABEL" > "$GEMINI_PROFILE"
printf "export GEMINI_HOME=%q\n" "${config.geminiHome}" >> "$GEMINI_PROFILE"
printf "export GEMINI_CLI_DISABLE_UPDATE_CHECK=true\n" >> "$GEMINI_PROFILE"
printf "export GEMINI_CLI_NONINTERACTIVE=true\n" >> "$GEMINI_PROFILE"
printf "export GEMINI_CLI_APPROVAL_MODE=yolo\n" >> "$GEMINI_PROFILE"
printf "alias gemini='/usr/local/bin/gemini-wrapper'\n" >> "$GEMINI_PROFILE"
cat <<'EOF' >> "$GEMINI_PROFILE"
if [[ -f "$GEMINI_HOME/.api-key" ]]; then
  export GEMINI_API_KEY="$(cat "$GEMINI_HOME/.api-key" | tr -d '\r\n')"
fi
EOF
chmod 0644 "$GEMINI_PROFILE" || true

docker_git_upsert_ssh_env "GEMINI_AUTH_LABEL" "$GEMINI_AUTH_LABEL"
docker_git_upsert_ssh_env "GEMINI_API_KEY" "\${GEMINI_API_KEY:-}"
docker_git_upsert_ssh_env "GEMINI_CLI_DISABLE_UPDATE_CHECK" "true"
docker_git_upsert_ssh_env "GEMINI_CLI_NONINTERACTIVE" "true"
docker_git_upsert_ssh_env "GEMINI_CLI_APPROVAL_MODE" "yolo"`

const entrypointGeminiNoticeTemplate = String.raw`# Ensure global GEMINI.md exists for container context
GEMINI_MD_PATH="__GEMINI_HOME__/GEMINI.md"
GEMINI_WORKSPACE_CONTEXT="Контекст workspace: repository"
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
    GEMINI_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID ($ISSUE_URL)"
  else
    GEMINI_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID"
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
    GEMINI_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID ($PR_URL)"
  elif [[ -n "$PR_ID" ]]; then
    GEMINI_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID"
  else
    GEMINI_WORKSPACE_CONTEXT="Контекст workspace: pull request ($REPO_REF)"
  fi
fi

cat <<EOF > "$GEMINI_MD_PATH"
<!-- docker-git-managed:gemini-md -->
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, gemini, claude, opencode, oh-my-opencode, sshpass, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): __TARGET_DIR__
Доступные workspace пути: __TARGET_DIR__
$GEMINI_WORKSPACE_CONTEXT
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.
Если ты видишь файлы AGENTS.md, GEMINI.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.
<!-- /docker-git-managed:gemini-md -->
EOF
chown 1000:1000 "$GEMINI_MD_PATH" || true`

const renderEntrypointGeminiNotice = (config: TemplateConfig): string =>
  entrypointGeminiNoticeTemplate
    .replaceAll("__GEMINI_HOME__", config.geminiHome)
    .replaceAll("__TARGET_DIR__", config.targetDir)

export const renderEntrypointGeminiConfig = (config: TemplateConfig): string =>
  [
    renderGeminiAuthConfig(config),
    renderGeminiPermissionSettingsConfig(config),
    renderGeminiMcpPlaywrightConfig(config),
    renderGeminiSudoConfig(config),
    renderGeminiProfileSetup(config),
    renderEntrypointGeminiNotice(config)
  ].join("\n\n")
