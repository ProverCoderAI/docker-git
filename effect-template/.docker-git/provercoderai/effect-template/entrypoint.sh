#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-}"
FORK_REPO_URL="${FORK_REPO_URL:-}"
TARGET_DIR="${TARGET_DIR:-/provercoderai/effect-template}"
GIT_AUTH_USER="${GIT_AUTH_USER:-${GITHUB_USER:-x-access-token}}"
GIT_AUTH_TOKEN="${GIT_AUTH_TOKEN:-${GITHUB_TOKEN:-}}"
GH_TOKEN="${GH_TOKEN:-${GIT_AUTH_TOKEN:-}}"
GIT_USER_NAME="${GIT_USER_NAME:-}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-}"
CODEX_AUTO_UPDATE="${CODEX_AUTO_UPDATE:-1}"

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
if [[ -f /etc/zsh/zshrc ]] && ! grep -q "zz-codex-resume.sh" /etc/zsh/zshrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then source /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/zsh/zshrc
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
autoload -Uz compinit
compinit

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

if [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=244"
  ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
EOF
fi

# Ensure global AGENTS.md exists for container context
AGENTS_PATH="/home/dev/.codex/AGENTS.md"
LEGACY_AGENTS_PATH="/home/dev/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): /provercoderai/effect-template"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
if [[ ! -f "$AGENTS_PATH" ]]; then
  cat <<'AGENTS_EOF' > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): /provercoderai/effect-template
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
  LEGACY_SUM="$(cksum "$LEGACY_AGENTS_PATH" 2>/dev/null | awk '{print $1 ":" $2}')"
  CODEX_SUM="$(cksum "$AGENTS_PATH" 2>/dev/null | awk '{print $1 ":" $2}')"
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

# 2) Ensure GH_TOKEN is available for SSH sessions if provided
if [[ -n "$GH_TOKEN" ]]; then
  printf "export GH_TOKEN=%q\n" "$GH_TOKEN" > /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
  SSH_ENV_PATH="/home/dev/.ssh/environment"
  printf "%s\n" "GH_TOKEN=$GH_TOKEN" > "$SSH_ENV_PATH"
  if [[ -n "$GITHUB_TOKEN" ]]; then
    printf "%s\n" "GITHUB_TOKEN=$GITHUB_TOKEN" >> "$SSH_ENV_PATH"
  fi
  chmod 600 "$SSH_ENV_PATH"
  chown 1000:1000 "$SSH_ENV_PATH" || true
fi

# 3) Configure git identity for the dev user if provided
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
        DEFAULT_REF="$(git ls-remote --symref "$AUTH_REPO_URL" HEAD 2>/dev/null | awk '/^ref:/ {print $2}' | head -n 1)"
        DEFAULT_BRANCH="$(printf "%s" "$DEFAULT_REF" | sed 's#^refs/heads/##')"
        if [[ -n "$DEFAULT_BRANCH" ]]; then
          echo "[clone] branch '$REPO_REF' missing; retrying with '$DEFAULT_BRANCH'"
          if ! su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --progress --branch '$DEFAULT_BRANCH' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
            echo "[clone] git clone failed for $REPO_URL"
            CLONE_OK=0
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

if [[ "$CLONE_OK" -eq 1 && -n "$FORK_REPO_URL" && -d "$TARGET_DIR/.git" ]]; then
  AUTH_FORK_URL="$FORK_REPO_URL"
  if [[ -n "$GIT_AUTH_TOKEN" && "$FORK_REPO_URL" == https://* ]]; then
    AUTH_FORK_URL="$(printf "%s" "$FORK_REPO_URL" | sed "s#^https://#https://${GIT_AUTH_USER}:${GIT_AUTH_TOKEN}@#")"
  fi
  if [[ "$FORK_REPO_URL" != "$REPO_URL" ]]; then
    su - dev -c "cd '$TARGET_DIR' && git remote set-url origin '$AUTH_FORK_URL'" || true
    su - dev -c "cd '$TARGET_DIR' && git remote add upstream '$AUTH_REPO_URL' 2>/dev/null || git remote set-url upstream '$AUTH_REPO_URL'" || true
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

# 5) Run sshd in foreground
exec /usr/sbin/sshd -D
