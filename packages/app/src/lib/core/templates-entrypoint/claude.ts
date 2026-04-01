import type { TemplateConfig } from "../domain.js"
import { renderClaudeGlobalPromptSetup, renderClaudeWrapperSetup } from "./claude-extra-config.js"

const claudeAuthRootContainerPath = (sshUser: string): string => `/home/${sshUser}/.docker-git/.orch/auth/claude`

const claudeAuthConfigTemplate = String
  .raw`# Claude Code: expose CLAUDE_CONFIG_DIR for SSH sessions (OAuth cache lives under ~/.docker-git/.orch/auth/claude)
CLAUDE_LABEL_RAW="$CLAUDE_AUTH_LABEL"
if [[ -z "$CLAUDE_LABEL_RAW" ]]; then
  CLAUDE_LABEL_RAW="default"
fi

CLAUDE_LABEL_NORM="$(printf "%s" "$CLAUDE_LABEL_RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "$CLAUDE_LABEL_NORM" ]]; then
  CLAUDE_LABEL_NORM="default"
fi

CLAUDE_AUTH_ROOT="__CLAUDE_AUTH_ROOT__"
CLAUDE_CONFIG_DIR="$CLAUDE_AUTH_ROOT/$CLAUDE_LABEL_NORM"

# Backward compatibility: if default auth is stored directly under claude root, reuse it.
if [[ "$CLAUDE_LABEL_NORM" == "default" ]]; then
  CLAUDE_ROOT_TOKEN_FILE="$CLAUDE_AUTH_ROOT/.oauth-token"
  CLAUDE_ROOT_CONFIG_FILE="$CLAUDE_AUTH_ROOT/.config.json"
  if [[ -f "$CLAUDE_ROOT_TOKEN_FILE" ]] || [[ -f "$CLAUDE_ROOT_CONFIG_FILE" ]]; then
    CLAUDE_CONFIG_DIR="$CLAUDE_AUTH_ROOT"
  fi
fi

export CLAUDE_CONFIG_DIR

mkdir -p "$CLAUDE_CONFIG_DIR" || true
CLAUDE_HOME_DIR="__CLAUDE_HOME_DIR__"
CLAUDE_HOME_JSON="__CLAUDE_HOME_JSON__"
mkdir -p "$CLAUDE_HOME_DIR" || true
CLAUDE_TOKEN_FILE="$CLAUDE_CONFIG_DIR/.oauth-token"
CLAUDE_CREDENTIALS_FILE="$CLAUDE_CONFIG_DIR/.credentials.json"
CLAUDE_NESTED_CREDENTIALS_FILE="$CLAUDE_CONFIG_DIR/.claude/.credentials.json"

docker_git_prepare_claude_auth_mode() {
  if [[ -s "$CLAUDE_TOKEN_FILE" ]]; then
    rm -f "$CLAUDE_CREDENTIALS_FILE" "$CLAUDE_NESTED_CREDENTIALS_FILE" "$CLAUDE_HOME_DIR/.credentials.json" || true
  fi
}

docker_git_prepare_claude_auth_mode

docker_git_link_claude_file() {
  local source_path="$1"
  local link_path="$2"

  # Preserve user-created regular files and seed config dir once.
  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    if [[ -f "$link_path" && ! -e "$source_path" ]]; then
      cp "$link_path" "$source_path" || true
      chmod 0600 "$source_path" || true
    fi
    return 0
  fi

  ln -sfn "$source_path" "$link_path" || true
}

docker_git_link_claude_home_file() {
  local relative_path="$1"
  local source_path="$CLAUDE_CONFIG_DIR/$relative_path"
  local link_path="$CLAUDE_HOME_DIR/$relative_path"
  docker_git_link_claude_file "$source_path" "$link_path"
}

docker_git_link_claude_home_file ".oauth-token"
docker_git_link_claude_home_file ".config.json"
docker_git_link_claude_home_file ".claude.json"
if [[ ! -s "$CLAUDE_TOKEN_FILE" ]]; then
  docker_git_link_claude_home_file ".credentials.json"
fi
docker_git_link_claude_file "$CLAUDE_CONFIG_DIR/.claude.json" "$CLAUDE_HOME_JSON"

docker_git_refresh_claude_oauth_token() {
  local token=""
  if [[ -f "$CLAUDE_TOKEN_FILE" ]]; then
    token="$(tr -d '\r\n' < "$CLAUDE_TOKEN_FILE")"
  fi
  if [[ -n "$token" ]]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$token"
  else
    unset CLAUDE_CODE_OAUTH_TOKEN || true
  fi
}

docker_git_refresh_claude_oauth_token`

const renderClaudeAuthConfig = (config: TemplateConfig): string =>
  claudeAuthConfigTemplate
    .replaceAll("__CLAUDE_AUTH_ROOT__", claudeAuthRootContainerPath(config.sshUser))
    .replaceAll("__CLAUDE_HOME_DIR__", `/home/${config.sshUser}/.claude`)
    .replaceAll("__CLAUDE_HOME_JSON__", `/home/${config.sshUser}/.claude.json`)

const renderClaudeCliInstall = (): string =>
  String.raw`# Claude Code: ensure CLI command exists (non-blocking startup self-heal)
docker_git_ensure_claude_cli() {
  if command -v claude >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    return 0
  fi

  NPM_ROOT="$(npm root -g 2>/dev/null || true)"
  CLAUDE_CLI_JS="$NPM_ROOT/@anthropic-ai/claude-code/cli.js"
  if [[ -z "$NPM_ROOT" || ! -f "$CLAUDE_CLI_JS" ]]; then
    echo "docker-git: claude cli.js not found under npm global root; skip shim restore" >&2
    return 0
  fi

  # Rebuild a minimal shim when npm package exists but binary link is missing.
  cat <<'EOF' > /usr/local/bin/claude
#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "claude: npm is required but missing" >&2
  exit 127
fi

NPM_ROOT="$(npm root -g 2>/dev/null || true)"
CLAUDE_CLI_JS="$NPM_ROOT/@anthropic-ai/claude-code/cli.js"
if [[ -z "$NPM_ROOT" || ! -f "$CLAUDE_CLI_JS" ]]; then
  echo "claude: cli.js not found under npm global root" >&2
  exit 127
fi

exec node "$CLAUDE_CLI_JS" "$@"
EOF
  chmod 0755 /usr/local/bin/claude || true
  ln -sf /usr/local/bin/claude /usr/bin/claude || true
}

docker_git_ensure_claude_cli`

const renderClaudePermissionSettingsConfig = (): string =>
  String.raw`# Claude Code: keep permission settings in sync with docker-git defaults
CLAUDE_PERMISSION_SETTINGS_FILE="$CLAUDE_CONFIG_DIR/settings.json"
docker_git_sync_claude_permissions() {
  CLAUDE_PERMISSION_SETTINGS_FILE="$CLAUDE_PERMISSION_SETTINGS_FILE" node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const settingsPath = process.env.CLAUDE_PERMISSION_SETTINGS_FILE
if (typeof settingsPath !== "string" || settingsPath.length === 0) {
  process.exit(0)
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

let settings = {}
try {
  const raw = fs.readFileSync(settingsPath, "utf8")
  const parsed = JSON.parse(raw)
  settings = isRecord(parsed) ? parsed : {}
} catch {
  settings = {}
}

const currentPermissions = isRecord(settings.permissions) ? settings.permissions : {}
const nextPermissions = {
  ...currentPermissions,
  defaultMode: "bypassPermissions"
}
const nextSettings = {
  ...settings,
  permissions: nextPermissions
}

if (JSON.stringify(settings) === JSON.stringify(nextSettings)) {
  process.exit(0)
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n", { mode: 0o600 })
NODE
}

docker_git_sync_claude_permissions
chmod 0600 "$CLAUDE_PERMISSION_SETTINGS_FILE" 2>/dev/null || true
chown 1000:1000 "$CLAUDE_PERMISSION_SETTINGS_FILE" 2>/dev/null || true`

const renderClaudeMcpPlaywrightConfig = (): string =>
  String.raw`# Claude Code: keep Playwright MCP config in sync with container settings
CLAUDE_SETTINGS_FILE="${"$"}{CLAUDE_HOME_JSON:-$CLAUDE_CONFIG_DIR/.claude.json}"
docker_git_sync_claude_playwright_mcp() {
  CLAUDE_SETTINGS_FILE="$CLAUDE_SETTINGS_FILE" MCP_PLAYWRIGHT_ENABLE="$MCP_PLAYWRIGHT_ENABLE" node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const settingsPath = process.env.CLAUDE_SETTINGS_FILE
if (typeof settingsPath !== "string" || settingsPath.length === 0) {
  process.exit(0)
}

const enablePlaywright = process.env.MCP_PLAYWRIGHT_ENABLE === "1"
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

let settings = {}
try {
  const raw = fs.readFileSync(settingsPath, "utf8")
  const parsed = JSON.parse(raw)
  settings = isRecord(parsed) ? parsed : {}
} catch {
  settings = {}
}

const currentServers = isRecord(settings.mcpServers) ? settings.mcpServers : {}
const nextServers = { ...currentServers }
if (enablePlaywright) {
  nextServers.playwright = {
    type: "stdio",
    command: "docker-git-playwright-mcp",
    args: [],
    env: {}
  }
} else {
  delete nextServers.playwright
}

const nextSettings = { ...settings }
if (Object.keys(nextServers).length > 0) {
  nextSettings.mcpServers = nextServers
} else {
  delete nextSettings.mcpServers
}

if (JSON.stringify(settings) === JSON.stringify(nextSettings)) {
  process.exit(0)
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n", { mode: 0o600 })
NODE
}

docker_git_sync_claude_playwright_mcp
chown 1000:1000 "$CLAUDE_SETTINGS_FILE" 2>/dev/null || true`

const renderClaudeProfileSetup = (): string =>
  String.raw`CLAUDE_PROFILE="/etc/profile.d/claude-config.sh"
printf "export CLAUDE_AUTH_LABEL=%q\n" "$CLAUDE_AUTH_LABEL" > "$CLAUDE_PROFILE"
printf "export CLAUDE_CONFIG_DIR=%q\n" "$CLAUDE_CONFIG_DIR" >> "$CLAUDE_PROFILE"
printf "export CLAUDE_AUTO_SYSTEM_PROMPT=%q\n" "$CLAUDE_AUTO_SYSTEM_PROMPT" >> "$CLAUDE_PROFILE"
cat <<'EOF' >> "$CLAUDE_PROFILE"
CLAUDE_TOKEN_FILE="${"$"}{CLAUDE_CONFIG_DIR:-$HOME/.claude}/.oauth-token"
if [[ -f "$CLAUDE_TOKEN_FILE" ]]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '\r\n' < "$CLAUDE_TOKEN_FILE")"
else
  unset CLAUDE_CODE_OAUTH_TOKEN || true
fi
EOF
chmod 0644 "$CLAUDE_PROFILE" || true

docker_git_upsert_ssh_env "CLAUDE_AUTH_LABEL" "$CLAUDE_AUTH_LABEL"
docker_git_upsert_ssh_env "CLAUDE_CONFIG_DIR" "$CLAUDE_CONFIG_DIR"
docker_git_upsert_ssh_env "CLAUDE_CODE_OAUTH_TOKEN" "${"$"}{CLAUDE_CODE_OAUTH_TOKEN:-}"
docker_git_upsert_ssh_env "CLAUDE_AUTO_SYSTEM_PROMPT" "$CLAUDE_AUTO_SYSTEM_PROMPT"`

export const renderEntrypointClaudeConfig = (config: TemplateConfig): string =>
  [
    renderClaudeAuthConfig(config),
    renderClaudeCliInstall(),
    renderClaudePermissionSettingsConfig(),
    renderClaudeMcpPlaywrightConfig(),
    renderClaudeGlobalPromptSetup(config),
    renderClaudeWrapperSetup(),
    renderClaudeProfileSetup()
  ].join("\n\n")
