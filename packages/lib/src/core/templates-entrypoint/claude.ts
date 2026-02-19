import type { TemplateConfig } from "../domain.js"

const claudeAuthRootContainerPath = (sshUser: string): string => `/home/${sshUser}/.docker-git/.orch/auth/claude`

const renderClaudeAuthConfig = (config: TemplateConfig): string =>
  String
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

CLAUDE_AUTH_ROOT="${claudeAuthRootContainerPath(config.sshUser)}"
CLAUDE_CONFIG_DIR="$CLAUDE_AUTH_ROOT/$CLAUDE_LABEL_NORM"
export CLAUDE_CONFIG_DIR

mkdir -p "$CLAUDE_CONFIG_DIR" || true

CLAUDE_TOKEN_FILE="$CLAUDE_CONFIG_DIR/.oauth-token"
docker_git_refresh_claude_oauth_token() {
  local token=""
  if [[ -f "$CLAUDE_TOKEN_FILE" ]]; then
    token="$(tr -d '\r\n' < "$CLAUDE_TOKEN_FILE")"
  fi
  export CLAUDE_CODE_OAUTH_TOKEN="$token"
}

docker_git_refresh_claude_oauth_token`

const renderClaudeWrapperSetup = (): string =>
  String.raw`CLAUDE_REAL_BIN="/usr/local/bin/.docker-git-claude-real"
CLAUDE_WRAPPER_BIN="/usr/local/bin/claude"
if command -v claude >/dev/null 2>&1; then
  CURRENT_CLAUDE_BIN="$(command -v claude)"
  if [[ "$CURRENT_CLAUDE_BIN" != "$CLAUDE_REAL_BIN" && ! -f "$CLAUDE_REAL_BIN" ]]; then
    mv "$CURRENT_CLAUDE_BIN" "$CLAUDE_REAL_BIN"
  fi
  if [[ -f "$CLAUDE_REAL_BIN" ]]; then
    cat <<'EOF' > "$CLAUDE_WRAPPER_BIN"
#!/usr/bin/env bash
set -euo pipefail

CLAUDE_REAL_BIN="/usr/local/bin/.docker-git-claude-real"
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
    chmod 0755 "$CLAUDE_WRAPPER_BIN" || true
  fi
fi`

const renderClaudeProfileSetup = (): string =>
  String.raw`CLAUDE_PROFILE="/etc/profile.d/claude-config.sh"
printf "export CLAUDE_AUTH_LABEL=%q\n" "$CLAUDE_AUTH_LABEL" > "$CLAUDE_PROFILE"
printf "export CLAUDE_CONFIG_DIR=%q\n" "$CLAUDE_CONFIG_DIR" >> "$CLAUDE_PROFILE"
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
docker_git_upsert_ssh_env "CLAUDE_CODE_OAUTH_TOKEN" "$CLAUDE_CODE_OAUTH_TOKEN"`

export const renderEntrypointClaudeConfig = (config: TemplateConfig): string =>
  [
    renderClaudeAuthConfig(config),
    renderClaudeWrapperSetup(),
    renderClaudeProfileSetup()
  ].join("\n\n")
