/* jscpd:ignore-start */
import type { TemplateConfig } from "../domain.js"

export { renderEntrypointCodexResumeHint } from "./codex-resume-hint.js"

export const renderEntrypointCodexHome = (config: TemplateConfig): string =>
  `# Ensure Codex home exists if mounted
mkdir -p ${config.codexHome} && chown -R 1000:1000 ${config.codexHome}

DOCKER_GIT_CODEX_BOOTSTRAP="/home/${config.sshUser}/.docker-git/.orch/auth/codex/config.toml"
if [[ -f "$DOCKER_GIT_CODEX_BOOTSTRAP" && ! -f "${config.codexHome}/config.toml" ]]; then cp "$DOCKER_GIT_CODEX_BOOTSTRAP" "${config.codexHome}/config.toml"; chown 1000:1000 "${config.codexHome}/config.toml" || true; fi

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
  DOCKER_GIT_CODEX_AUTH_ROOT="/home/${config.sshUser}/.docker-git/.orch/auth/codex"; CODEX_SHARED_HOME="${config.codexHome}-shared"
  mkdir -p "$CODEX_SHARED_HOME" && chown -R 1000:1000 "$CODEX_SHARED_HOME" || true
  AUTH_FILE="${config.codexHome}/auth.json"; SHARED_AUTH_FILE="$CODEX_SHARED_HOME/auth.json"; SHARED_AUTH_SEED="$DOCKER_GIT_CODEX_AUTH_ROOT/auth.json"
  if [[ "$CODEX_LABEL_NORM" != "default" ]]; then
    SHARED_AUTH_FILE="$CODEX_SHARED_HOME/$CODEX_LABEL_NORM/auth.json"; SHARED_AUTH_SEED="$DOCKER_GIT_CODEX_AUTH_ROOT/$CODEX_LABEL_NORM/auth.json"; mkdir -p "$(dirname "$SHARED_AUTH_FILE")"
  fi
  if [[ -f "$SHARED_AUTH_SEED" ]]; then
    cp "$SHARED_AUTH_SEED" "$SHARED_AUTH_FILE"
    chmod 600 "$SHARED_AUTH_FILE" || true
    chown 1000:1000 "$SHARED_AUTH_FILE" || true
  else
    rm -f "$SHARED_AUTH_FILE" || true
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

const entrypointMcpPlaywrightTemplate = String.raw`# Optional: configure Browser MCP for Codex (Rust browser-connection)
CODEX_CONFIG_FILE="__CODEX_HOME__/config.toml"
DOCKER_GIT_BROWSER_PROJECT="${"$"}{DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"
if [[ -z "$DOCKER_GIT_BROWSER_PROJECT" ]]; then
  DOCKER_GIT_BROWSER_PROJECT="$(hostname)"
fi
DOCKER_GIT_BROWSER_NETWORK="container:$DOCKER_GIT_BROWSER_PROJECT"

# Keep config.toml consistent with the container build.
# If browser MCP is disabled for this container, remove the block so Codex
# doesn't try (and fail) to spawn browser-connection.
if [[ "$MCP_PLAYWRIGHT_ENABLE" != "1" ]]; then
  if [[ -f "$CODEX_CONFIG_FILE" ]] && grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Browser MCP/ { next }
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
model = "gpt-5.5"
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
model = "gpt-5.5"
model_context_window = 1050000
model_auto_compact_token_limit = 945000
model_reasoning_effort = "xhigh"
plan_mode_reasoning_effort = "xhigh"
EOF
    chown 1000:1000 "$CODEX_CONFIG_FILE" || true
  fi

  # Replace the docker-git Browser MCP block to allow upgrades via --force without manual edits.
  if grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Browser MCP/ { next }
      /^# docker-git: Playwright MCP/ { next }
      /^\[mcp_servers[.]playwright([.]|\])/ { skip=1; next }
      skip==1 && /^\[/ { skip=0 }
      skip==0 { print }
    ' "$CODEX_CONFIG_FILE" > "$CODEX_CONFIG_FILE.tmp"
    mv "$CODEX_CONFIG_FILE.tmp" "$CODEX_CONFIG_FILE"
  fi

  cat <<EOF >> "$CODEX_CONFIG_FILE"

# docker-git: Browser MCP (rust-browser-connection)
[mcp_servers.playwright]
command = "browser-connection"
args = ["--project", "$DOCKER_GIT_BROWSER_PROJECT", "--network", "$DOCKER_GIT_BROWSER_NETWORK"]
EOF
fi`

export const renderEntrypointMcpPlaywright = (config: TemplateConfig): string =>
  entrypointMcpPlaywrightTemplate
    .replaceAll("__CODEX_HOME__", config.codexHome)
    .replaceAll("__SERVICE_NAME__", config.serviceName)

const entrypointProjectCodexSkillsSyncTemplate = String
  .raw`# Mirror project-owned Codex skill trees into CODEX_HOME without overwriting global skills.
docker_git_sync_project_codex_skills() {
  local codex_home="${"$"}{CODEX_HOME:-__CODEX_HOME__}"
  local project_dir="${"$"}{TARGET_DIR:-}"
  local project_skills_root="$codex_home/skills/.docker-git-project"
  local linked=0
  local spec=""
  local mount_name=""
  local relative_path=""

  if [[ -z "$project_dir" || ! -d "$project_dir" ]]; then
    return 0
  fi

  mkdir -p "$codex_home/skills"
  rm -rf "$project_skills_root"
  mkdir -p "$project_skills_root"

  # Priority goes from generic/shared skill trees -> Codex-specific trees.
  for spec in \
    "10-root-skills::.skills" \
    "20-agents-skills::.agents/skills" \
    "30-agents-dot-skills::.agents/.skills" \
    "80-codex-skills::.codex/skills" \
    "90-codex-dot-skills::.codex/.skills"; do
    mount_name="${"$"}{spec%%::*}"
    relative_path="${"$"}{spec#*::}"

    if [[ -d "$project_dir/$relative_path" ]]; then
      ln -sfn "$project_dir/$relative_path" "$project_skills_root/$mount_name"
      chown -h 1000:1000 "$project_skills_root/$mount_name" 2>/dev/null || true
      linked=1
    fi
  done

  # Extra entries via CODEX_EXTRA_SKILLS_PATHS (comma- or newline-separated "prio-name::relative/path").
  local extra_specs="${"$"}{CODEX_EXTRA_SKILLS_PATHS:-}"
  if [[ -n "$extra_specs" ]]; then
    extra_specs="${"$"}{extra_specs//,/$'\n'}"
    while IFS= read -r spec; do
      [[ -z "$spec" ]] && continue
      mount_name="${"$"}{spec%%::*}"
      relative_path="${"$"}{spec#*::}"
      if [[ -d "$project_dir/$relative_path" ]]; then
        ln -sfn "$project_dir/$relative_path" "$project_skills_root/$mount_name"
        chown -h 1000:1000 "$project_skills_root/$mount_name" 2>/dev/null || true
        linked=1
      fi
    done <<< "$extra_specs"
  fi

  chown 1000:1000 "$codex_home/skills" "$project_skills_root" 2>/dev/null || true

  if [[ "$linked" -eq 1 ]]; then
    echo "[codex-skills] linked project skill trees into $project_skills_root"
  fi
}`

export const renderEntrypointProjectCodexSkillsSync = (config: TemplateConfig): string =>
  entrypointProjectCodexSkillsSyncTemplate.replaceAll("__CODEX_HOME__", config.codexHome)
/* jscpd:ignore-end */
