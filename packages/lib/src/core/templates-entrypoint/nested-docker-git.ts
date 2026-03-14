import type { TemplateConfig } from "../domain.js"

const entrypointDockerGitBootstrapTemplate = String
  .raw`# Bootstrap ~/.docker-git for nested docker-git usage inside this container.
DOCKER_GIT_HOME="/home/__SSH_USER__/.docker-git"
DOCKER_GIT_AUTH_DIR="$DOCKER_GIT_HOME/.orch/auth/codex"
DOCKER_GIT_CLAUDE_AUTH_DIR="$DOCKER_GIT_HOME/.orch/auth/claude"
DOCKER_GIT_ENV_DIR="$DOCKER_GIT_HOME/.orch/env"
DOCKER_GIT_ENV_GLOBAL="$DOCKER_GIT_ENV_DIR/global.env"
DOCKER_GIT_ENV_PROJECT="$DOCKER_GIT_ENV_DIR/project.env"
DOCKER_GIT_AUTH_KEYS="$DOCKER_GIT_HOME/authorized_keys"
BOOTSTRAP_ROOT="/opt/docker-git/bootstrap"
BOOTSTRAP_SOURCE_ROOT="$BOOTSTRAP_ROOT/source"
BOOTSTRAP_AUTH_KEYS="$BOOTSTRAP_SOURCE_ROOT/authorized-keys/__AUTHORIZED_KEYS_BASENAME__"
BOOTSTRAP_CODEX_AUTH_DIR="$BOOTSTRAP_SOURCE_ROOT/project-auth/codex"
BOOTSTRAP_CODEX_SHARED_AUTH_DIR="$BOOTSTRAP_SOURCE_ROOT/shared-auth/codex"
BOOTSTRAP_CLAUDE_AUTH_DIR="$BOOTSTRAP_SOURCE_ROOT/project-auth/claude"
BOOTSTRAP_ENV_GLOBAL="$BOOTSTRAP_SOURCE_ROOT/env-global/__ENV_GLOBAL_BASENAME__"
BOOTSTRAP_ENV_PROJECT="$BOOTSTRAP_SOURCE_ROOT/env-project/__ENV_PROJECT_BASENAME__"

mkdir -p "$DOCKER_GIT_AUTH_DIR" "$DOCKER_GIT_CLAUDE_AUTH_DIR" "$DOCKER_GIT_ENV_DIR" "$DOCKER_GIT_HOME/.orch/auth/gh"

sync_file_if_present() {
  local source="$1"
  local target="$2"
  if [[ ! -f "$source" ]]; then
    return 1
  fi
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
  return 0
}

sync_file_or_remove() {
  local source="$1"
  local target="$2"
  if [[ -f "$source" ]]; then
    sync_file_if_present "$source" "$target"
    return 0
  fi
  rm -f "$target" || true
  return 1
}

sync_dir_entries() {
  local source="$1"
  local target="$2"
  if [[ ! -d "$source" ]]; then
    return 0
  fi
  mkdir -p "$target"
  (
    cd "$source"
    find . -mindepth 1 -print
  ) | while IFS= read -r entry; do
    local source_entry="$source/$entry"
    local target_entry="$target/$entry"
    if [[ -d "$source_entry" ]]; then
      mkdir -p "$target_entry"
    elif [[ -f "$source_entry" ]]; then
      mkdir -p "$(dirname "$target_entry")"
      cp "$source_entry" "$target_entry"
    fi
  done
}

sync_labeled_auth_files() {
  local source_root="$1"
  local target_root="$2"

  sync_file_or_remove "$source_root/auth.json" "$target_root/auth.json" || true

  if [[ -d "$source_root" ]]; then
    (
      cd "$source_root"
      find . -mindepth 1 -maxdepth 1 -type d -print
    ) | while IFS= read -r entry; do
      sync_file_or_remove "$source_root/$entry/auth.json" "$target_root/$entry/auth.json" || true
    done
  fi

  if [[ -d "$target_root" ]]; then
    (
      cd "$target_root"
      find . -mindepth 1 -maxdepth 1 -type d -print
    ) | while IFS= read -r entry; do
      if [[ ! -d "$source_root/$entry" ]]; then
        rm -f "$target_root/$entry/auth.json" || true
      fi
    done
  fi
}

if [[ ! -f "$DOCKER_GIT_AUTH_KEYS" && -f "/home/__SSH_USER__/.ssh/authorized_keys" ]]; then
  cp "/home/__SSH_USER__/.ssh/authorized_keys" "$DOCKER_GIT_AUTH_KEYS"
fi
sync_file_if_present "$BOOTSTRAP_AUTH_KEYS" "$DOCKER_GIT_AUTH_KEYS" || true
if [[ -f "$DOCKER_GIT_AUTH_KEYS" ]]; then
  chmod 600 "$DOCKER_GIT_AUTH_KEYS" || true
fi

sync_file_if_present "$BOOTSTRAP_ENV_GLOBAL" "$DOCKER_GIT_ENV_GLOBAL" || true
if [[ ! -f "$DOCKER_GIT_ENV_GLOBAL" ]]; then
  cat <<'EOF' > "$DOCKER_GIT_ENV_GLOBAL"
# docker-git env
# KEY=value
EOF
fi
sync_file_if_present "$BOOTSTRAP_ENV_PROJECT" "$DOCKER_GIT_ENV_PROJECT" || true
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
  printf "%s=%s\n" "$key" "$value" >> "$tmp"
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

sync_dir_entries "$BOOTSTRAP_CODEX_AUTH_DIR" "$DOCKER_GIT_AUTH_DIR"
sync_labeled_auth_files "$BOOTSTRAP_CODEX_SHARED_AUTH_DIR" "$DOCKER_GIT_AUTH_DIR"
sync_dir_entries "$BOOTSTRAP_CLAUDE_AUTH_DIR" "$DOCKER_GIT_CLAUDE_AUTH_DIR"

if [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GH_TOKEN" "$GH_TOKEN"
fi
if [[ -n "$GITHUB_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GITHUB_TOKEN"
elif [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GH_TOKEN"
fi

SOURCE_CODEX_CONFIG="__CODEX_HOME__/config.toml"
copy_if_distinct_file "$SOURCE_CODEX_CONFIG" "$DOCKER_GIT_AUTH_DIR/config.toml" || true

SOURCE_SHARED_AUTH="__CODEX_HOME__-shared/auth.json"
SOURCE_LOCAL_AUTH="__CODEX_HOME__/auth.json"
if [[ -f "$SOURCE_SHARED_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_SHARED_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
elif [[ -f "$SOURCE_LOCAL_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_LOCAL_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
else
  rm -f "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi
if [[ -f "$DOCKER_GIT_AUTH_DIR/auth.json" ]]; then
  chmod 600 "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi

chown -R 1000:1000 "$DOCKER_GIT_HOME" || true`

export const renderEntrypointDockerGitBootstrap = (config: TemplateConfig): string =>
  entrypointDockerGitBootstrapTemplate
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll(
      "__AUTHORIZED_KEYS_BASENAME__",
      config.authorizedKeysPath.replaceAll("\\", "/").split("/").at(-1) ?? "authorized_keys"
    )
    .replaceAll("__ENV_GLOBAL_BASENAME__", config.envGlobalPath.replaceAll("\\", "/").split("/").at(-1) ?? "global.env")
    .replaceAll(
      "__ENV_PROJECT_BASENAME__",
      config.envProjectPath.replaceAll("\\", "/").split("/").at(-1) ?? "project.env"
    )
    .replaceAll("__CODEX_HOME__", config.codexHome)
