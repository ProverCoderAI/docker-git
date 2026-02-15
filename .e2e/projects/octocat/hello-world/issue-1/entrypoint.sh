#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-}"
FORK_REPO_URL="${FORK_REPO_URL:-}"
TARGET_DIR="${TARGET_DIR:-/home/dev/octocat/hello-world/issue-1}"
GIT_AUTH_USER="${GIT_AUTH_USER:-${GITHUB_USER:-x-access-token}}"
GIT_AUTH_TOKEN="${GIT_AUTH_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}"
GH_TOKEN="${GH_TOKEN:-${GIT_AUTH_TOKEN:-}}"
GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
GIT_USER_NAME="${GIT_USER_NAME:-}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-}"
CODEX_AUTO_UPDATE="${CODEX_AUTO_UPDATE:-1}"
MCP_PLAYWRIGHT_ENABLE="${MCP_PLAYWRIGHT_ENABLE:-0}"
MCP_PLAYWRIGHT_CDP_ENDPOINT="${MCP_PLAYWRIGHT_CDP_ENDPOINT:-}"
MCP_PLAYWRIGHT_ISOLATED="${MCP_PLAYWRIGHT_ISOLATED:-1}"

# 1) Authorized keys are mounted from host at /authorized_keys
mkdir -p /home/dev/.ssh
chmod 700 /home/dev/.ssh

if [[ -f /authorized_keys ]]; then
  cp /authorized_keys /home/dev/.ssh/authorized_keys
  chmod 600 /home/dev/.ssh/authorized_keys
fi

chown -R 1000:1000 /home/dev/.ssh

# Ensure Codex home exists if mounted
mkdir -p /home/dev/.codex
chown -R 1000:1000 /home/dev/.codex

# Ensure home ownership matches the dev UID/GID (volumes may be stale)
HOME_OWNER="$(stat -c "%u:%g" /home/dev 2>/dev/null || echo "")"
if [[ "$HOME_OWNER" != "1000:1000" ]]; then
  chown -R 1000:1000 /home/dev || true
fi

# Share Codex auth.json across projects (avoids refresh_token_reused)
CODEX_SHARE_AUTH="${CODEX_SHARE_AUTH:-1}"
if [[ "$CODEX_SHARE_AUTH" == "1" ]]; then
  CODEX_SHARED_HOME="/home/dev/.codex-shared"
  mkdir -p "$CODEX_SHARED_HOME"
  chown -R 1000:1000 "$CODEX_SHARED_HOME" || true

  AUTH_FILE="/home/dev/.codex/auth.json"
  SHARED_AUTH_FILE="$CODEX_SHARED_HOME/auth.json"

  # Guard against a bad bind mount creating a directory at auth.json.
  if [[ -d "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_FILE.bak-$(date +%s)" || true
  fi
  if [[ -e "$AUTH_FILE" && ! -L "$AUTH_FILE" ]]; then
    rm -f "$AUTH_FILE" || true
  fi

  ln -sf "$SHARED_AUTH_FILE" "$AUTH_FILE"
fi

# Bootstrap ~/.docker-git for nested docker-git usage inside this container.
DOCKER_GIT_HOME="/home/dev/.docker-git"
DOCKER_GIT_AUTH_DIR="$DOCKER_GIT_HOME/.orch/auth/codex"
DOCKER_GIT_ENV_DIR="$DOCKER_GIT_HOME/.orch/env"
DOCKER_GIT_ENV_GLOBAL="$DOCKER_GIT_ENV_DIR/global.env"
DOCKER_GIT_ENV_PROJECT="$DOCKER_GIT_ENV_DIR/project.env"
DOCKER_GIT_AUTH_KEYS="$DOCKER_GIT_HOME/authorized_keys"

mkdir -p "$DOCKER_GIT_AUTH_DIR" "$DOCKER_GIT_ENV_DIR" "$DOCKER_GIT_HOME/.orch/auth/gh"

if [[ -f "/home/dev/.ssh/authorized_keys" ]]; then
  cp "/home/dev/.ssh/authorized_keys" "$DOCKER_GIT_AUTH_KEYS"
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

if [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GH_TOKEN" "$GH_TOKEN"
fi
if [[ -n "$GITHUB_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GITHUB_TOKEN"
elif [[ -n "$GH_TOKEN" ]]; then
  upsert_env_var "$DOCKER_GIT_ENV_GLOBAL" "GITHUB_TOKEN" "$GH_TOKEN"
fi

SOURCE_CODEX_CONFIG="/home/dev/.codex/config.toml"
copy_if_distinct_file "$SOURCE_CODEX_CONFIG" "$DOCKER_GIT_AUTH_DIR/config.toml" || true

SOURCE_SHARED_AUTH="/home/dev/.codex-shared/auth.json"
SOURCE_LOCAL_AUTH="/home/dev/.codex/auth.json"
if [[ -f "$SOURCE_SHARED_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_SHARED_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
elif [[ -f "$SOURCE_LOCAL_AUTH" ]]; then
  copy_if_distinct_file "$SOURCE_LOCAL_AUTH" "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi
if [[ -f "$DOCKER_GIT_AUTH_DIR/auth.json" ]]; then
  chmod 600 "$DOCKER_GIT_AUTH_DIR/auth.json" || true
fi

chown -R 1000:1000 "$DOCKER_GIT_HOME" || true

# Optional: configure Playwright MCP for Codex (browser automation)
CODEX_CONFIG_FILE="/home/dev/.codex/config.toml"

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
    MCP_PLAYWRIGHT_CDP_ENDPOINT="http://dg-hello-world-issue-1-browser:9223"
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
fi

# Prefer zsh for dev when available
if command -v zsh >/dev/null 2>&1; then
  usermod -s /usr/bin/zsh dev || true
fi

# Ensure dev has a zshrc and disable newuser wizard
ZSHENV_PATH="/etc/zsh/zshenv"
if [[ -f "$ZSHENV_PATH" ]]; then
  if ! grep -q "ZSH_DISABLE_NEWUSER_INSTALL" "$ZSHENV_PATH"; then
    printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" >> "$ZSHENV_PATH"
  fi
else
  printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" > "$ZSHENV_PATH"
fi
USER_ZSHRC="/home/dev/.zshrc"
if [[ ! -f "$USER_ZSHRC" ]]; then
  cat <<'EOF' > "$USER_ZSHRC"
# docker-git default zshrc
if [ -f /etc/zsh/zshrc ]; then
  source /etc/zsh/zshrc
fi
EOF
  chown 1000:1000 "$USER_ZSHRC" || true
fi

# Ensure docker-git prompt is configured for interactive shells
PROMPT_PATH="/etc/profile.d/zz-prompt.sh"
if [[ ! -s "$PROMPT_PATH" ]]; then
  cat <<'EOF' > "$PROMPT_PATH"
docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[\t] \w"
  if [ -n "$b" ]; then
    PS1="${base} (${b})> "
  else
    PS1="${base}> "
  fi
}
if [ -n "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND="docker_git_prompt_apply;$PROMPT_COMMAND"
else
  PROMPT_COMMAND="docker_git_prompt_apply"
fi
EOF
  chmod 0644 "$PROMPT_PATH"
fi
if ! grep -q "zz-prompt.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-prompt.sh ]; then . /etc/profile.d/zz-prompt.sh; fi" >> /etc/bash.bashrc
fi

# Ensure bash completion is configured for interactive shells
COMPLETION_PATH="/etc/profile.d/zz-bash-completion.sh"
if [[ ! -s "$COMPLETION_PATH" ]]; then
  cat <<'EOF' > "$COMPLETION_PATH"
if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi
EOF
  chmod 0644 "$COMPLETION_PATH"
fi
if ! grep -q "zz-bash-completion.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-bash-completion.sh ]; then . /etc/profile.d/zz-bash-completion.sh; fi" >> /etc/bash.bashrc
fi

# Ensure bash history is configured for interactive shells
HISTORY_PATH="/etc/profile.d/zz-bash-history.sh"
if [[ ! -s "$HISTORY_PATH" ]]; then
  cat <<'EOF' > "$HISTORY_PATH"
if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      HISTFILE="${HISTFILE:-$HOME/.bash_history}"
      HISTSIZE="${HISTSIZE:-10000}"
      HISTFILESIZE="${HISTFILESIZE:-20000}"
      HISTCONTROL="${HISTCONTROL:-ignoredups:erasedups}"
      export HISTFILE HISTSIZE HISTFILESIZE HISTCONTROL
      shopt -s histappend
      if [ -n "${PROMPT_COMMAND-}" ]; then
        PROMPT_COMMAND="history -a; ${PROMPT_COMMAND}"
      else
        PROMPT_COMMAND="history -a"
      fi
      ;;
  esac
fi
EOF
  chmod 0644 "$HISTORY_PATH"
fi
if ! grep -q "zz-bash-history.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-bash-history.sh ]; then . /etc/profile.d/zz-bash-history.sh; fi" >> /etc/bash.bashrc
fi

# Ensure readline history search bindings for dev
INPUTRC_PATH="/home/dev/.inputrc"
if [[ ! -f "$INPUTRC_PATH" ]]; then
  cat <<'EOF' > "$INPUTRC_PATH"
set show-all-if-ambiguous on
set completion-ignore-case on
"\e[A": history-search-backward
"\e[B": history-search-forward
EOF
  chown 1000:1000 "$INPUTRC_PATH" || true
fi

# Ensure zsh config exists for autosuggestions
ZSHRC_PATH="/etc/zsh/zshrc"
if [[ ! -s "$ZSHRC_PATH" ]]; then
  mkdir -p /etc/zsh
  cat <<'EOF' > "$ZSHRC_PATH"
setopt PROMPT_SUBST

# Terminal compatibility: if terminfo for $TERM is missing (common over SSH),
# fall back to xterm-256color so ZLE doesn't garble the display.
if command -v infocmp >/dev/null 2>&1; then
  if ! infocmp "$TERM" >/dev/null 2>&1; then
    export TERM=xterm-256color
  fi
fi

autoload -Uz compinit
compinit

# Completion UX: cycle matches instead of listing them into scrollback.
setopt AUTO_MENU
setopt MENU_COMPLETE
unsetopt AUTO_LIST
unsetopt LIST_BEEP

# Command completion ordering: prefer real commands/builtins over internal helper functions.
zstyle ':completion:*' tag-order builtins commands aliases reserved-words functions

autoload -Uz add-zsh-hook
docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[%*] %~"
  if [[ -n "$b" ]]; then
    PROMPT="$base ($b)> "
  else
    PROMPT="$base> "
  fi
}
add-zsh-hook precmd docker_git_prompt_apply

HISTFILE="${HISTFILE:-$HOME/.zsh_history}"
HISTSIZE="${HISTSIZE:-10000}"
SAVEHIST="${SAVEHIST:-20000}"
setopt HIST_IGNORE_ALL_DUPS
setopt SHARE_HISTORY
setopt INC_APPEND_HISTORY

if [ -f "$HISTFILE" ]; then
  fc -R "$HISTFILE" 2>/dev/null || true
fi
if [ -f "$HOME/.bash_history" ] && [ "$HISTFILE" != "$HOME/.bash_history" ]; then
  fc -R "$HOME/.bash_history" 2>/dev/null || true
fi

bindkey '^[[A' history-search-backward
bindkey '^[[B' history-search-forward

if [[ "${DOCKER_GIT_ZSH_AUTOSUGGEST:-1}" == "1" ]] && [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  # Suggest from history first, then fall back to completion (commands + paths).
  # This gives "ghost text" suggestions without needing to press <Tab>.
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="${DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE:-fg=8,italic}"
  if [[ -n "${DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY-}" ]]; then
    ZSH_AUTOSUGGEST_STRATEGY=(${=DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY})
  else
    ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  fi
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
EOF
fi

# Ensure codex resume hint is shown for interactive shells
CODEX_HINT_PATH="/etc/profile.d/zz-codex-resume.sh"
if [[ ! -s "$CODEX_HINT_PATH" ]]; then
  cat <<'EOF' > "$CODEX_HINT_PATH"
if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      if [ -z "${CODEX_RESUME_HINT_SHOWN-}" ]; then
        echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
        export CODEX_RESUME_HINT_SHOWN=1
      fi
      ;;
  esac
fi
if [ -n "$ZSH_VERSION" ]; then
  if [[ "$-" == *i* ]]; then
    if [[ -z "${CODEX_RESUME_HINT_SHOWN-}" ]]; then
      echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
      export CODEX_RESUME_HINT_SHOWN=1
    fi
  fi
fi
EOF
  chmod 0644 "$CODEX_HINT_PATH"
fi
if ! grep -q "zz-codex-resume.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then . /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/bash.bashrc
fi
if [[ -s /etc/zsh/zshrc ]] && ! grep -q "zz-codex-resume.sh" /etc/zsh/zshrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then source /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/zsh/zshrc
fi

# Ensure global AGENTS.md exists for container context
AGENTS_PATH="/home/dev/.codex/AGENTS.md"
LEGACY_AGENTS_PATH="/home/dev/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): /home/dev/octocat/hello-world/issue-1"
WORKSPACES_LINE="Доступные workspace пути: /home/dev/octocat/hello-world/issue-1"
WORKSPACE_INFO_LINE="Контекст workspace: repository"
FOCUS_LINE="Фокус задачи: работай только в workspace, который запрашивает пользователь. Текущий workspace: /home/dev/octocat/hello-world/issue-1"
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
  ISSUE_AGENTS_HINT_LINE="Issue AGENTS.md: /home/dev/octocat/hello-world/issue-1/AGENTS.md"
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
fi

# Ensure docker socket access for dev
if [[ -S /var/run/docker.sock ]]; then
  DOCKER_SOCK_GID="$(stat -c "%g" /var/run/docker.sock)"
  DOCKER_GROUP="$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1 || true)"
  if [[ -z "$DOCKER_GROUP" ]]; then
    DOCKER_GROUP="docker"
    groupadd -g "$DOCKER_SOCK_GID" "$DOCKER_GROUP" || true
  fi
  usermod -aG "$DOCKER_GROUP" dev || true
  printf "export DOCKER_HOST=unix:///var/run/docker.sock
" > /etc/profile.d/docker-host.sh
fi

# 2) Ensure GitHub auth vars are available for SSH sessions if provided
if [[ -n "$GH_TOKEN" || -n "$GITHUB_TOKEN" ]]; then
  EFFECTIVE_GITHUB_TOKEN="$GITHUB_TOKEN"
  if [[ -z "$EFFECTIVE_GITHUB_TOKEN" ]]; then
    EFFECTIVE_GITHUB_TOKEN="$GH_TOKEN"
  fi

  EFFECTIVE_GH_TOKEN="$GH_TOKEN"
  if [[ -z "$EFFECTIVE_GH_TOKEN" ]]; then
    EFFECTIVE_GH_TOKEN="$EFFECTIVE_GITHUB_TOKEN"
  fi

  printf "export GH_TOKEN=%q\n" "$EFFECTIVE_GH_TOKEN" > /etc/profile.d/gh-token.sh
  printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN" >> /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
  SSH_ENV_PATH="/home/dev/.ssh/environment"
  printf "%s\n" "GH_TOKEN=$EFFECTIVE_GH_TOKEN" > "$SSH_ENV_PATH"
  printf "%s\n" "GITHUB_TOKEN=$EFFECTIVE_GITHUB_TOKEN" >> "$SSH_ENV_PATH"
  chmod 600 "$SSH_ENV_PATH"
  chown 1000:1000 "$SSH_ENV_PATH" || true

  SAFE_GH_TOKEN="$(printf "%q" "$GH_TOKEN")"
  # Keep git+https auth in sync with gh auth so push/pull works without manual setup.
  su - dev -c "GH_TOKEN=$SAFE_GH_TOKEN gh auth setup-git --hostname github.com --force" || true

  GH_LOGIN="$(su - dev -c "GH_TOKEN=$SAFE_GH_TOKEN gh api user --jq .login" 2>/dev/null || true)"
  GH_ID="$(su - dev -c "GH_TOKEN=$SAFE_GH_TOKEN gh api user --jq .id" 2>/dev/null || true)"
  GH_LOGIN="$(printf "%s" "$GH_LOGIN" | tr -d '\r\n')"
  GH_ID="$(printf "%s" "$GH_ID" | tr -d '\r\n')"

  if [[ -z "$GIT_USER_NAME" && -n "$GH_LOGIN" ]]; then
    GIT_USER_NAME="$GH_LOGIN"
  fi
  if [[ -z "$GIT_USER_EMAIL" && -n "$GH_LOGIN" && -n "$GH_ID" ]]; then
    GIT_USER_EMAIL="${GH_ID}+${GH_LOGIN}@users.noreply.github.com"
  fi
fi

# 3) Configure git credential helper for HTTPS remotes
GIT_CREDENTIAL_HELPER_PATH="/usr/local/bin/docker-git-credential-helper"
cat <<'EOF' > "$GIT_CREDENTIAL_HELPER_PATH"
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 || "$1" != "get" ]]; then
  exit 0
fi

token="$GITHUB_TOKEN"
if [[ -z "$token" ]]; then
  token="$GH_TOKEN"
fi

if [[ -z "$token" ]]; then
  exit 0
fi

printf "%s\n" "username=x-access-token"
printf "%s\n" "password=$token"
EOF
chmod 0755 "$GIT_CREDENTIAL_HELPER_PATH"
su - dev -c "git config --global credential.helper '$GIT_CREDENTIAL_HELPER_PATH'"

# 4) Configure git identity for the dev user if provided
if [[ -n "$GIT_USER_NAME" ]]; then
  SAFE_GIT_USER_NAME="$(printf "%q" "$GIT_USER_NAME")"
  su - dev -c "git config --global user.name $SAFE_GIT_USER_NAME"
fi

if [[ -n "$GIT_USER_EMAIL" ]]; then
  SAFE_GIT_USER_EMAIL="$(printf "%q" "$GIT_USER_EMAIL")"
  su - dev -c "git config --global user.email $SAFE_GIT_USER_EMAIL"
fi

# 3) Install global git hooks to protect main/master
HOOKS_DIR="/opt/docker-git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"
mkdir -p "$HOOKS_DIR"
if [[ ! -f "$PRE_PUSH_HOOK" ]]; then
  cat <<'EOF' > "$PRE_PUSH_HOOK"
#!/usr/bin/env bash
set -euo pipefail

protected_branches=("refs/heads/main" "refs/heads/master")
allow_delete="${DOCKER_GIT_ALLOW_DELETE:-}"

while read -r local_ref local_sha remote_ref remote_sha; do
  if [[ -z "$remote_ref" ]]; then
    continue
  fi
  for protected in "${protected_branches[@]}"; do
    if [[ "$remote_ref" == "$protected" || "$local_ref" == "$protected" ]]; then
      echo "docker-git: push to protected branch '${protected##*/}' is disabled."
      echo "docker-git: create a new branch: git checkout -b <name>"
      exit 1
    fi
  done
  if [[ "$local_sha" == "0000000000000000000000000000000000000000" && "$remote_ref" == refs/heads/* ]]; then
    if [[ "$allow_delete" != "1" ]]; then
      echo "docker-git: deleting remote branches is disabled (set DOCKER_GIT_ALLOW_DELETE=1 to override)."
      exit 1
    fi
  fi
done
EOF
  chmod 0755 "$PRE_PUSH_HOOK"
fi
git config --system core.hooksPath "$HOOKS_DIR" || true
git config --global core.hooksPath "$HOOKS_DIR" || true

# 4) Start background tasks so SSH can come up immediately
(
# 1) Keep Codex CLI up to date if requested (bun only)
if [[ "$CODEX_AUTO_UPDATE" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[codex] updating via bun..."
    script -q -e -c "bun add -g @openai/codex@latest" /dev/null || true
  else
    echo "[codex] bun not found, skipping auto-update"
  fi
fi

# 2) Auto-clone repo if not already present
mkdir -p /run/docker-git
CLONE_DONE_PATH="/run/docker-git/clone.done"
CLONE_FAIL_PATH="/run/docker-git/clone.failed"
rm -f "$CLONE_DONE_PATH" "$CLONE_FAIL_PATH"

CLONE_OK=1

if [[ -z "$REPO_URL" ]]; then
  echo "[clone] skip (no repo url)"
elif [[ -d "$TARGET_DIR/.git" ]]; then
  echo "[clone] skip (already cloned)"
else
  mkdir -p "$TARGET_DIR"
  if [[ "$TARGET_DIR" != "/" ]]; then
    chown -R 1000:1000 "$TARGET_DIR"
  fi
  chown -R 1000:1000 /home/dev

  AUTH_REPO_URL="$REPO_URL"
  if [[ -n "$GIT_AUTH_TOKEN" && "$REPO_URL" == https://* ]]; then
    AUTH_REPO_URL="$(printf "%s" "$REPO_URL" | sed "s#^https://#https://${GIT_AUTH_USER}:${GIT_AUTH_TOKEN}@#")"
  fi
  if [[ -n "$REPO_REF" ]]; then
    if [[ "$REPO_REF" == refs/pull/* ]]; then
      REF_BRANCH="pr-$(printf "%s" "$REPO_REF" | tr '/:' '--')"
      if ! su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] git clone failed for $REPO_URL"
        CLONE_OK=0
      else
        if ! su - dev -c "cd '$TARGET_DIR' && GIT_TERMINAL_PROMPT=0 git fetch --progress origin '$REPO_REF':'$REF_BRANCH' && git checkout '$REF_BRANCH'"; then
          echo "[clone] git fetch failed for $REPO_REF"
          CLONE_OK=0
        fi
      fi
    else
      if ! su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --progress --branch '$REPO_REF' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        DEFAULT_REF="$(git ls-remote --symref "$AUTH_REPO_URL" HEAD 2>/dev/null | awk '/^ref:/ {print $2}' | head -n 1 || true)"
        DEFAULT_BRANCH="$(printf "%s" "$DEFAULT_REF" | sed 's#^refs/heads/##')"
        if [[ -n "$DEFAULT_BRANCH" ]]; then
          echo "[clone] branch '$REPO_REF' missing; retrying with '$DEFAULT_BRANCH'"
          if ! su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --progress --branch '$DEFAULT_BRANCH' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
            echo "[clone] git clone failed for $REPO_URL"
            CLONE_OK=0
          elif [[ "$REPO_REF" == issue-* ]]; then
            if ! su - dev -c "cd '$TARGET_DIR' && git checkout -B '$REPO_REF'"; then
              echo "[clone] failed to create local branch '$REPO_REF'"
              CLONE_OK=0
            fi
          fi
        else
          echo "[clone] git clone failed for $REPO_URL"
          CLONE_OK=0
        fi
      fi
    fi
  else
    if ! su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi
fi

if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" ]]; then
  if [[ -n "$FORK_REPO_URL" && "$FORK_REPO_URL" != "$REPO_URL" ]]; then
    su - dev -c "cd '$TARGET_DIR' && git remote set-url origin '$FORK_REPO_URL'" || true
    su - dev -c "cd '$TARGET_DIR' && git remote add upstream '$REPO_URL' 2>/dev/null || git remote set-url upstream '$REPO_URL'" || true
  else
    su - dev -c "cd '$TARGET_DIR' && git remote set-url origin '$REPO_URL'" || true
    su - dev -c "cd '$TARGET_DIR' && git remote remove upstream >/dev/null 2>&1 || true" || true
  fi
fi

if [[ "$CLONE_OK" -eq 1 && "$REPO_REF" == issue-* && -d "$TARGET_DIR/.git" ]]; then
ISSUE_ID="$(printf "%s" "$REPO_REF" | sed -E 's#^issue-##')"
ISSUE_URL=""
if [[ "$REPO_URL" == https://github.com/* ]]; then
  ISSUE_REPO="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
  if [[ -n "$ISSUE_REPO" ]]; then
    ISSUE_URL="https://github.com/$ISSUE_REPO/issues/$ISSUE_ID"
  fi
fi
if [[ -z "$ISSUE_URL" ]]; then
  ISSUE_URL="n/a"
fi

ISSUE_AGENTS_PATH="$TARGET_DIR/AGENTS.md"
ISSUE_MANAGED_START="<!-- docker-git:issue-managed:start -->"
ISSUE_MANAGED_END="<!-- docker-git:issue-managed:end -->"
ISSUE_MANAGED_BLOCK="$(cat <<EOF
$ISSUE_MANAGED_START
Issue workspace: #$ISSUE_ID
Issue URL: $ISSUE_URL
Workspace path: $TARGET_DIR

Работай только над этим issue, если пользователь не попросил другое.
Если нужен первоисточник требований, открой Issue URL.
$ISSUE_MANAGED_END
EOF
)"

if [[ ! -e "$ISSUE_AGENTS_PATH" ]]; then
  printf "%s
" "$ISSUE_MANAGED_BLOCK" > "$ISSUE_AGENTS_PATH"
else
  TMP_ISSUE_AGENTS_PATH="$(mktemp)"
  if grep -qF "$ISSUE_MANAGED_START" "$ISSUE_AGENTS_PATH" && grep -qF "$ISSUE_MANAGED_END" "$ISSUE_AGENTS_PATH"; then
    awk -v start="$ISSUE_MANAGED_START" -v end="$ISSUE_MANAGED_END" -v repl="$ISSUE_MANAGED_BLOCK" '
      BEGIN { in_block = 0 }
      $0 == start { print repl; in_block = 1; next }
      $0 == end { in_block = 0; next }
      in_block == 0 { print }
    ' "$ISSUE_AGENTS_PATH" > "$TMP_ISSUE_AGENTS_PATH"
  else
    sed       -e '/^# docker-git issue workspace$/d'       -e '/^Issue workspace: #/d'       -e '/^Issue URL: /d'       -e '/^Workspace path: /d'       -e '/^Работай только над этим issue, если пользователь не попросил другое[.]$/d'       -e '/^Если нужен первоисточник требований, открой Issue URL[.]$/d'       "$ISSUE_AGENTS_PATH" > "$TMP_ISSUE_AGENTS_PATH"
    if [[ -s "$TMP_ISSUE_AGENTS_PATH" ]]; then
      printf "
" >> "$TMP_ISSUE_AGENTS_PATH"
    fi
    printf "%s
" "$ISSUE_MANAGED_BLOCK" >> "$TMP_ISSUE_AGENTS_PATH"
  fi
  mv "$TMP_ISSUE_AGENTS_PATH" "$ISSUE_AGENTS_PATH"
fi
if [[ -e "$ISSUE_AGENTS_PATH" ]]; then
  chown 1000:1000 "$ISSUE_AGENTS_PATH" || true
fi

EXCLUDE_PATH="$TARGET_DIR/.git/info/exclude"
if [[ -f "$ISSUE_AGENTS_PATH" ]]; then
  touch "$EXCLUDE_PATH"
  if ! grep -qx "AGENTS.md" "$EXCLUDE_PATH"; then
    printf "%s
" "AGENTS.md" >> "$EXCLUDE_PATH"
  fi
fi
fi

if [[ "$CLONE_OK" -eq 1 ]]; then
  echo "[clone] done"
  touch "$CLONE_DONE_PATH"
else
  echo "[clone] failed"
  touch "$CLONE_FAIL_PATH"
fi
) &

# 4.5) Snapshot baseline processes for terminal session filtering
mkdir -p /run/docker-git
BASELINE_PATH="/run/docker-git/terminal-baseline.pids"
if [[ ! -f "$BASELINE_PATH" ]]; then
  ps -eo pid= > "$BASELINE_PATH" || true
fi

# 4.75) Disable Ubuntu MOTD noise for SSH sessions
PAM_SSHD="/etc/pam.d/sshd"
if [[ -f "$PAM_SSHD" ]]; then
  sed -i 's/^[[:space:]]*session[[:space:]]\+optional[[:space:]]\+pam_motd\.so/#&/' "$PAM_SSHD" || true
  sed -i 's/^[[:space:]]*session[[:space:]]\+optional[[:space:]]\+pam_lastlog\.so/#&/' "$PAM_SSHD" || true
fi

# Also disable sshd's own banners (e.g. "Last login")
mkdir -p /etc/ssh/sshd_config.d || true
DOCKER_GIT_SSHD_CONF="/etc/ssh/sshd_config.d/zz-docker-git-clean.conf"
cat <<'EOF' > "$DOCKER_GIT_SSHD_CONF"
PrintMotd no
PrintLastLog no
EOF
chmod 0644 "$DOCKER_GIT_SSHD_CONF" || true

# 5) Run sshd in foreground
exec /usr/sbin/sshd -D