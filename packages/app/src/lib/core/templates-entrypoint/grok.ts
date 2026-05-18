/* jscpd:ignore-start */
import type { TemplateConfig } from "../domain.js"

// CHANGE: add Grok CLI entrypoint configuration
// WHY: issue #304 requires Grok auth, Playwright MCP and unrestricted agent permissions
// QUOTE(ТЗ): "Реализовать поддержку авторизации grok"
// REF: issue-304
// SOURCE: https://x.ai/news/grok-build-cli
// FORMAT THEOREM: renderEntrypointGrokConfig(config) -> valid_bash_script
// PURITY: CORE
// INVARIANT: Grok credentials are isolated by GROK_AUTH_LABEL
// COMPLEXITY: O(1)

const grokAuthRootContainerPath = (sshUser: string): string => `/home/${sshUser}/.docker-git/.orch/auth/grok`

// CHANGE: render shell parameter defaults through TypeScript interpolation
// WHY: String.raw preserves escaped \${...}, making optional Grok credentials fail under bash nounset
// QUOTE(ТЗ): "GitHub Actions ... all CI checks are passing"
// REF: issue-304-ci
// SOURCE: n/a
// FORMAT THEOREM: unset(GROK_DEPLOYMENT_KEY) -> safe_empty_value(GROK_DEPLOYMENT_KEY)
// PURITY: CORE
// INVARIANT: Optional Grok API credentials never require a bound environment variable
// COMPLEXITY: O(1)
const grokDeploymentKeyDefaultExpansion = "${GROK_DEPLOYMENT_KEY:-}"
const grokApiKeyDefaultExpansion = "${GROK_API_KEY:-}"
const grokAuthLabelDefaultExpansion = "${GROK_AUTH_LABEL:-}"
const xaiApiKeyDefaultExpansion = "${XAI_API_KEY:-}"

const grokAuthConfigTemplate = String
  .raw`# Grok CLI: keep ~/.grok as a real home directory while sharing auth files from ~/.docker-git/.orch/auth/grok
GROK_LABEL_RAW="${grokAuthLabelDefaultExpansion}"
if [[ -z "$GROK_LABEL_RAW" ]]; then
  GROK_LABEL_RAW="default"
fi

GROK_LABEL_NORM="$(printf "%s" "$GROK_LABEL_RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "$GROK_LABEL_NORM" ]]; then
  GROK_LABEL_NORM="default"
fi
export GROK_AUTH_LABEL="$GROK_LABEL_NORM"

GROK_AUTH_ROOT="__GROK_AUTH_ROOT__"
export GROK_CONFIG_DIR="$GROK_AUTH_ROOT/$GROK_LABEL_NORM"

mkdir -p "$GROK_CONFIG_DIR" || true
GROK_HOME_DIR="__GROK_HOME_DIR__"
mkdir -p "$GROK_HOME_DIR" || true
GROK_SHARED_HOME_DIR="$GROK_CONFIG_DIR/.grok"
mkdir -p "$GROK_SHARED_HOME_DIR" || true

docker_git_link_grok_file() {
  local source_path="$1"
  local link_path="$2"

  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    if [[ -f "$link_path" && ! -e "$source_path" ]]; then
      cp "$link_path" "$source_path" || true
      chmod 0600 "$source_path" || true
    fi
    if [[ -d "$link_path" ]]; then
      return 0
    fi
  fi

  ln -sfn "$source_path" "$link_path" || true
}

docker_git_prepare_grok_home_dir() {
  if [[ -L "$GROK_HOME_DIR" ]]; then
    local previous_target
    previous_target="$(readlink -f "$GROK_HOME_DIR" || true)"
    rm -f "$GROK_HOME_DIR" || true
    mkdir -p "$GROK_HOME_DIR" || true
    if [[ -n "$previous_target" && -d "$previous_target" ]]; then
      cp -a "$previous_target"/. "$GROK_HOME_DIR"/ 2>/dev/null || true
    fi
    return 0
  fi

  mkdir -p "$GROK_HOME_DIR" || true
}

docker_git_prepare_grok_home_dir

docker_git_link_grok_file "$GROK_CONFIG_DIR/.api-key" "$GROK_HOME_DIR/.api-key"
docker_git_link_grok_file "$GROK_CONFIG_DIR/.env" "$GROK_HOME_DIR/.env"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/auth.json" "$GROK_HOME_DIR/auth.json"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/config.toml" "$GROK_HOME_DIR/config.toml"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/managed_config.toml" "$GROK_HOME_DIR/managed_config.toml"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/requirements.toml" "$GROK_HOME_DIR/requirements.toml"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/user-settings.json" "$GROK_HOME_DIR/user-settings.json"
docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/settings.json" "$GROK_HOME_DIR/settings.json"

GROK_REAL_BIN="$(command -v grok || echo "/usr/local/bin/grok")"
GROK_WRAPPER_BIN="/usr/local/bin/grok-wrapper"
if [[ -f "$GROK_REAL_BIN" && "$GROK_REAL_BIN" != "$GROK_WRAPPER_BIN" ]]; then
  if [[ ! -f "$GROK_WRAPPER_BIN" ]]; then
    cat <<'EOF' > "$GROK_WRAPPER_BIN"
#!/usr/bin/env bash
GROK_ORIGINAL_BIN="__GROK_REAL_BIN__"
for arg in "$@"; do
  if [[ "$arg" == "--no-sandbox" ]]; then
    exec "$GROK_ORIGINAL_BIN" "$@"
  fi
done
exec "$GROK_ORIGINAL_BIN" --no-sandbox "$@"
EOF
    sed -i "s#__GROK_REAL_BIN__#$GROK_REAL_BIN#g" "$GROK_WRAPPER_BIN" || true
    chmod 0755 "$GROK_WRAPPER_BIN" || true
  fi
fi

docker_git_refresh_grok_env() {
  local RESOLVED_GROK_API_KEY
  if [[ -f "$GROK_HOME_DIR/.api-key" ]]; then
    RESOLVED_GROK_API_KEY="$(cat "$GROK_HOME_DIR/.api-key" | tr -d '\r\n')"
  elif [[ -f "$GROK_HOME_DIR/.env" ]]; then
    RESOLVED_GROK_API_KEY="$(grep -E "^GROK_DEPLOYMENT_KEY=" "$GROK_HOME_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//" || true)"
    if [[ -z "$RESOLVED_GROK_API_KEY" ]]; then
      RESOLVED_GROK_API_KEY="$(grep -E "^GROK_API_KEY=" "$GROK_HOME_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//" || true)"
    fi
    if [[ -z "$RESOLVED_GROK_API_KEY" ]]; then
      RESOLVED_GROK_API_KEY="$(grep -E "^XAI_API_KEY=" "$GROK_HOME_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- | sed "s/^['\"]//;s/['\"]$//" || true)"
    fi
  elif [[ -n "${grokDeploymentKeyDefaultExpansion}" ]]; then
    RESOLVED_GROK_API_KEY="${grokDeploymentKeyDefaultExpansion}"
  elif [[ -n "${grokApiKeyDefaultExpansion}" ]]; then
    RESOLVED_GROK_API_KEY="${grokApiKeyDefaultExpansion}"
  elif [[ -n "${xaiApiKeyDefaultExpansion}" ]]; then
    RESOLVED_GROK_API_KEY="${xaiApiKeyDefaultExpansion}"
  else
    RESOLVED_GROK_API_KEY=""
  fi
  # Priority: selected account files, then GROK_DEPLOYMENT_KEY, GROK_API_KEY, XAI_API_KEY.
  if [[ -n "$RESOLVED_GROK_API_KEY" ]]; then
    export GROK_DEPLOYMENT_KEY="$RESOLVED_GROK_API_KEY"
    export GROK_API_KEY="$RESOLVED_GROK_API_KEY"
    export XAI_API_KEY="$RESOLVED_GROK_API_KEY"
  fi
}

docker_git_refresh_grok_env`

const renderGrokAuthConfig = (config: TemplateConfig): string =>
  grokAuthConfigTemplate
    .replaceAll("__GROK_AUTH_ROOT__", grokAuthRootContainerPath(config.sshUser))
    .replaceAll("__GROK_HOME_DIR__", config.grokHome)

const grokSettingsJsonTemplate = `{
  "sandboxMode": "off",
  "confirmBeforeToolUse": false,
  "mcpServers": {
    "playwright": {
      "command": "docker-git-playwright-mcp",
      "args": [],
      "trust": true
    }
  }
}`

const grokUserSettingsJsonTemplate = `{
  "sandboxMode": "off",
  "confirmBeforeToolUse": false
}`

const renderGrokPermissionSettingsConfig = (config: TemplateConfig): string =>
  String.raw`# Grok CLI: keep sandbox and MCP settings in sync with docker-git defaults
GROK_SETTINGS_DIR="${config.grokHome}"
GROK_CONFIG_SETTINGS_FILE="$GROK_SETTINGS_DIR/settings.json"
GROK_USER_SETTINGS_FILE="$GROK_SETTINGS_DIR/user-settings.json"

mkdir -p "$GROK_SETTINGS_DIR" || true

cat <<'EOF' > "$GROK_CONFIG_SETTINGS_FILE"
${grokSettingsJsonTemplate}
EOF

if [[ ! -s "$GROK_USER_SETTINGS_FILE" ]]; then
  cat <<'EOF' > "$GROK_USER_SETTINGS_FILE"
${grokUserSettingsJsonTemplate}
EOF
fi

GROK_SETTINGS_OWNER_UID="$(id -u "${config.sshUser}" 2>/dev/null || id -u)"
GROK_SETTINGS_OWNER_GID="$(id -g "${config.sshUser}" 2>/dev/null || id -g)"
chown -R "$GROK_SETTINGS_OWNER_UID:$GROK_SETTINGS_OWNER_GID" "$GROK_SETTINGS_DIR" || true
chmod 0600 "$GROK_CONFIG_SETTINGS_FILE" "$GROK_USER_SETTINGS_FILE" 2>/dev/null || true`

const renderGrokSudoConfig = (config: TemplateConfig): string =>
  String.raw`# Grok CLI: allow passwordless sudo for agent tasks
# Risk rationale: Grok runs inside an isolated per-project container. The sshUser
# value is validated as a Unix username before TemplateConfig construction, and
# passwordless sudo matches the broad container-local privileges expected for
# docker-git coding agents that need to install packages or manage services.
if [[ -d /etc/sudoers.d ]]; then
  echo "${config.sshUser} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/grok-agent
  chmod 0440 /etc/sudoers.d/grok-agent
fi`

const renderGrokProfileSetup = (config: TemplateConfig): string =>
  String.raw`GROK_PROFILE="/etc/profile.d/grok-config.sh"
printf "export GROK_AUTH_LABEL=%q\n" "$GROK_AUTH_LABEL" > "$GROK_PROFILE"
printf "export GROK_HOME=%q\n" "${config.grokHome}" >> "$GROK_PROFILE"
printf "alias grok='/usr/local/bin/grok-wrapper'\n" >> "$GROK_PROFILE"
cat <<'EOF' >> "$GROK_PROFILE"
if [[ -f "$GROK_HOME/.api-key" ]]; then
  API_KEY="$(cat "$GROK_HOME/.api-key" | tr -d '\r\n')"
  export GROK_DEPLOYMENT_KEY="$API_KEY"
  export GROK_API_KEY="$API_KEY"
  export XAI_API_KEY="$API_KEY"
fi
EOF
chmod 0644 "$GROK_PROFILE" || true

docker_git_upsert_ssh_env "GROK_AUTH_LABEL" "$GROK_AUTH_LABEL"
docker_git_upsert_ssh_env "GROK_DEPLOYMENT_KEY" "${grokDeploymentKeyDefaultExpansion}"
docker_git_upsert_ssh_env "GROK_API_KEY" "${grokApiKeyDefaultExpansion}"
docker_git_upsert_ssh_env "XAI_API_KEY" "${xaiApiKeyDefaultExpansion}"`

const entrypointGrokNoticeTemplate = String.raw`# Ensure global GROK.md exists for container context
GROK_MD_PATH="__GROK_HOME__/GROK.md"
GROK_WORKSPACE_CONTEXT="Контекст workspace: repository"
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
    GROK_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID ($ISSUE_URL)"
  else
    GROK_WORKSPACE_CONTEXT="Контекст workspace: issue #$ISSUE_ID"
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
    GROK_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID ($PR_URL)"
  elif [[ -n "$PR_ID" ]]; then
    GROK_WORKSPACE_CONTEXT="Контекст workspace: PR #$PR_ID"
  else
    GROK_WORKSPACE_CONTEXT="Контекст workspace: pull request ($REPO_REF)"
  fi
fi

GROK_SYSTEM_PROMPT_OVERRIDE_FILE="${"$"}{GROK_SYSTEM_PROMPT_OVERRIDE_FILE:-}"
GROK_SYSTEM_PROMPT_OVERRIDE="${"$"}{GROK_SYSTEM_PROMPT_OVERRIDE:-}"
GROK_DEFAULT_PROMPT_BODY="$(cat <<EOF
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, bun, codex, gemini, grok, claude, opencode, oh-my-opencode, sshpass, git, node и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): __TARGET_DIR__
Доступные workspace пути: __TARGET_DIR__
$GROK_WORKSPACE_CONTEXT
Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: __TARGET_DIR__
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Для решения задач обязательно используй subagents. Сам агент обязан выполнять финальную проверку, интеграцию и валидацию результата перед ответом пользователю.
Если ты видишь файлы AGENTS.md, GEMINI.md, GROK.md или CLAUDE.md внутри проекта, ты обязан их читать и соблюдать инструкции.
EOF
)"
GROK_DEFAULT_PROMPT_BODY="$(docker_git_decode_unicode_escapes "$GROK_DEFAULT_PROMPT_BODY")"
if [[ -n "$GROK_SYSTEM_PROMPT_OVERRIDE_FILE" && -r "$GROK_SYSTEM_PROMPT_OVERRIDE_FILE" ]]; then
  GROK_PROMPT_BODY="$(cat "$GROK_SYSTEM_PROMPT_OVERRIDE_FILE")"
elif [[ -n "$GROK_SYSTEM_PROMPT_OVERRIDE" ]]; then
  GROK_PROMPT_BODY="$GROK_SYSTEM_PROMPT_OVERRIDE"
else
  GROK_PROMPT_BODY="$GROK_DEFAULT_PROMPT_BODY"
fi

cat <<EOF > "$GROK_MD_PATH"
<!-- docker-git-managed:grok-md -->
$GROK_PROMPT_BODY
<!-- /docker-git-managed:grok-md -->
EOF
GROK_NOTICE_OWNER_UID="$(id -u "__SSH_USER__" 2>/dev/null || id -u)"
GROK_NOTICE_OWNER_GID="$(id -g "__SSH_USER__" 2>/dev/null || id -g)"
chown "$GROK_NOTICE_OWNER_UID:$GROK_NOTICE_OWNER_GID" "$GROK_MD_PATH" || true`

const renderEntrypointGrokNotice = (config: TemplateConfig): string =>
  entrypointGrokNoticeTemplate
    .replaceAll("__GROK_HOME__", config.grokHome)
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll("__TARGET_DIR__", config.targetDir)

/**
 * Renders the Grok CLI entrypoint bootstrap for a generated project container.
 *
 * @param config Project template configuration with SSH user, Grok home, and target directory paths.
 * @returns Bash fragment that wires Grok auth labels, config files, profile exports, sudo policy, and managed GROK.md.
 * @pure true
 * @effect none; CORE template renderer only constructs a string.
 * @invariant returned script keeps Grok credentials scoped by GROK_AUTH_LABEL.
 * @precondition config contains validated container paths from TemplateConfig construction.
 * @postcondition returned string contains all Grok setup fragments in deterministic order.
 * @complexity O(1) time / O(1) space.
 */
export const renderEntrypointGrokConfig = (config: TemplateConfig): string =>
  [
    renderGrokAuthConfig(config),
    renderGrokPermissionSettingsConfig(config),
    renderGrokSudoConfig(config),
    renderGrokProfileSetup(config),
    renderEntrypointGrokNotice(config)
  ].join("\n\n")
/* jscpd:ignore-end */
