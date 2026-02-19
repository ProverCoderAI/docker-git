import type { TemplateConfig } from "../domain.js"
import { renderInputRc } from "../templates-prompt.js"

export const renderEntrypointHeader = (config: TemplateConfig): string =>
  `#!/usr/bin/env bash
set -euo pipefail

REPO_URL="\${REPO_URL:-}"
REPO_REF="\${REPO_REF:-}"
FORK_REPO_URL="\${FORK_REPO_URL:-}"
TARGET_DIR="\${TARGET_DIR:-${config.targetDir}}"
if [[ "$TARGET_DIR" == "~" ]]; then
  TARGET_DIR="$HOME"
elif [[ "$TARGET_DIR" == "~/"* ]]; then
  TARGET_DIR="$HOME\${TARGET_DIR:1}"
fi
CLAUDE_AUTH_LABEL="\${CLAUDE_AUTH_LABEL:-}"
GIT_AUTH_USER="\${GIT_AUTH_USER:-\${GITHUB_USER:-x-access-token}}"
GIT_AUTH_TOKEN="\${GIT_AUTH_TOKEN:-\${GITHUB_TOKEN:-\${GH_TOKEN:-}}}"
GH_TOKEN="\${GH_TOKEN:-\${GIT_AUTH_TOKEN:-}}"
GITHUB_TOKEN="\${GITHUB_TOKEN:-\${GH_TOKEN:-}}"
GIT_USER_NAME="\${GIT_USER_NAME:-}"
GIT_USER_EMAIL="\${GIT_USER_EMAIL:-}"
CODEX_AUTO_UPDATE="\${CODEX_AUTO_UPDATE:-1}"
MCP_PLAYWRIGHT_ENABLE="\${MCP_PLAYWRIGHT_ENABLE:-${config.enableMcpPlaywright ? "1" : "0"}}"
MCP_PLAYWRIGHT_CDP_ENDPOINT="\${MCP_PLAYWRIGHT_CDP_ENDPOINT:-}"
MCP_PLAYWRIGHT_ISOLATED="\${MCP_PLAYWRIGHT_ISOLATED:-1}"

SSH_ENV_PATH="/home/${config.sshUser}/.ssh/environment"

docker_git_upsert_ssh_env() {
  local key="$1"
  local value="$2"

  if [[ -d "$SSH_ENV_PATH" ]]; then
    mv "$SSH_ENV_PATH" "$SSH_ENV_PATH.bak-$(date +%s)" || true
  fi

  mkdir -p "$(dirname "$SSH_ENV_PATH")"
  touch "$SSH_ENV_PATH"

  awk -v k="$key" -F= '$1 != k { print }' "$SSH_ENV_PATH" > "$SSH_ENV_PATH.tmp"
  mv "$SSH_ENV_PATH.tmp" "$SSH_ENV_PATH"

  printf "%s\n" "$key=$value" >> "$SSH_ENV_PATH"
  chmod 600 "$SSH_ENV_PATH" || true
  chown 1000:1000 "$SSH_ENV_PATH" || true
}`

export const renderEntrypointPackageCache = (config: TemplateConfig): string =>
  `# Share package manager caches across all docker-git containers
PACKAGE_CACHE_ROOT="/home/${config.sshUser}/.docker-git/.cache/packages"
PACKAGE_PNPM_STORE="\${npm_config_store_dir:-\${PNPM_STORE_DIR:-$PACKAGE_CACHE_ROOT/pnpm/store}}"
PACKAGE_NPM_CACHE="\${npm_config_cache:-\${NPM_CONFIG_CACHE:-$PACKAGE_CACHE_ROOT/npm}}"
PACKAGE_YARN_CACHE="\${YARN_CACHE_FOLDER:-$PACKAGE_CACHE_ROOT/yarn}"

mkdir -p "$PACKAGE_PNPM_STORE" "$PACKAGE_NPM_CACHE" "$PACKAGE_YARN_CACHE"
chown -R 1000:1000 "$PACKAGE_CACHE_ROOT" || true

cat <<EOF > /etc/profile.d/docker-git-package-cache.sh
export PNPM_STORE_DIR="$PACKAGE_PNPM_STORE"
export npm_config_store_dir="$PACKAGE_PNPM_STORE"
export NPM_CONFIG_CACHE="$PACKAGE_NPM_CACHE"
export npm_config_cache="$PACKAGE_NPM_CACHE"
export YARN_CACHE_FOLDER="$PACKAGE_YARN_CACHE"
EOF
chmod 0644 /etc/profile.d/docker-git-package-cache.sh

docker_git_upsert_ssh_env "PNPM_STORE_DIR" "$PACKAGE_PNPM_STORE"
docker_git_upsert_ssh_env "npm_config_store_dir" "$PACKAGE_PNPM_STORE"
docker_git_upsert_ssh_env "NPM_CONFIG_CACHE" "$PACKAGE_NPM_CACHE"
docker_git_upsert_ssh_env "npm_config_cache" "$PACKAGE_NPM_CACHE"
docker_git_upsert_ssh_env "YARN_CACHE_FOLDER" "$PACKAGE_YARN_CACHE"`

export const renderEntrypointAuthorizedKeys = (config: TemplateConfig): string =>
  `# 1) Authorized keys are mounted from host at /authorized_keys
mkdir -p /home/${config.sshUser}/.ssh
chmod 700 /home/${config.sshUser}/.ssh

if [[ -f /authorized_keys ]]; then
  cp /authorized_keys /home/${config.sshUser}/.ssh/authorized_keys
  chmod 600 /home/${config.sshUser}/.ssh/authorized_keys
fi

chown -R 1000:1000 /home/${config.sshUser}/.ssh`

export const renderEntrypointDockerSocket = (config: TemplateConfig): string =>
  `# Ensure docker socket access for ${config.sshUser}
if [[ -S /var/run/docker.sock ]]; then
  DOCKER_SOCK_GID="$(stat -c "%g" /var/run/docker.sock)"
  DOCKER_GROUP="$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1 || true)"
  if [[ -z "$DOCKER_GROUP" ]]; then
    DOCKER_GROUP="docker"
    groupadd -g "$DOCKER_SOCK_GID" "$DOCKER_GROUP" || true
  fi
  usermod -aG "$DOCKER_GROUP" ${config.sshUser} || true
  printf "export DOCKER_HOST=unix:///var/run/docker.sock\n" > /etc/profile.d/docker-host.sh
fi`

export const renderEntrypointZshShell = (config: TemplateConfig): string =>
  String.raw`# Prefer zsh for ${config.sshUser} when available
if command -v zsh >/dev/null 2>&1; then
  usermod -s /usr/bin/zsh ${config.sshUser} || true
fi`

export const renderEntrypointZshUserRc = (config: TemplateConfig): string =>
  String.raw`# Ensure ${config.sshUser} has a zshrc and disable newuser wizard
ZSHENV_PATH="/etc/zsh/zshenv"
if [[ -f "$ZSHENV_PATH" ]]; then
  if ! grep -q "ZSH_DISABLE_NEWUSER_INSTALL" "$ZSHENV_PATH"; then
    printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" >> "$ZSHENV_PATH"
  fi
else
  printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" > "$ZSHENV_PATH"
fi
USER_ZSHRC="/home/${config.sshUser}/.zshrc"
if [[ ! -f "$USER_ZSHRC" ]]; then
  cat <<'EOF' > "$USER_ZSHRC"
# docker-git default zshrc
if [ -f /etc/zsh/zshrc ]; then
  source /etc/zsh/zshrc
fi
EOF
  chown 1000:1000 "$USER_ZSHRC" || true
fi`

export const renderEntrypointInputRc = (config: TemplateConfig): string =>
  String.raw`# Ensure readline history search bindings for ${config.sshUser}
INPUTRC_PATH="/home/${config.sshUser}/.inputrc"
if [[ ! -f "$INPUTRC_PATH" ]]; then
  cat <<'EOF' > "$INPUTRC_PATH"
${renderInputRc()}
EOF
  chown 1000:1000 "$INPUTRC_PATH" || true
fi`

export const renderEntrypointBaseline = (): string =>
  `# 4.5) Snapshot baseline processes for terminal session filtering
mkdir -p /run/docker-git
BASELINE_PATH="/run/docker-git/terminal-baseline.pids"
if [[ ! -f "$BASELINE_PATH" ]]; then
  ps -eo pid= > "$BASELINE_PATH" || true
fi`

export const renderEntrypointDisableMotd = (): string =>
  String.raw`# 4.75) Disable Ubuntu MOTD noise for SSH sessions
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
chmod 0644 "$DOCKER_GIT_SSHD_CONF" || true`

export const renderEntrypointSshd = (): string => `# 5) Run sshd in foreground\nexec /usr/sbin/sshd -D`
