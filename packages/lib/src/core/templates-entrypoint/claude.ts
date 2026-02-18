import type { TemplateConfig } from "../domain.js"

const claudeAuthRootContainerPath = (sshUser: string): string => `/home/${sshUser}/.docker-git/.orch/auth/claude`

export const renderEntrypointClaudeConfig = (config: TemplateConfig): string =>
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

CLAUDE_PROFILE="/etc/profile.d/claude-config.sh"
printf "export CLAUDE_AUTH_LABEL=%q\n" "$CLAUDE_AUTH_LABEL" > "$CLAUDE_PROFILE"
printf "export CLAUDE_CONFIG_DIR=%q\n" "$CLAUDE_CONFIG_DIR" >> "$CLAUDE_PROFILE"
chmod 0644 "$CLAUDE_PROFILE" || true

docker_git_upsert_ssh_env "CLAUDE_AUTH_LABEL" "$CLAUDE_AUTH_LABEL"
docker_git_upsert_ssh_env "CLAUDE_CONFIG_DIR" "$CLAUDE_CONFIG_DIR"`
