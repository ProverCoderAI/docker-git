#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-}"
TARGET_DIR="${TARGET_DIR:-/effect-template}"
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

# 1.5) Keep Codex CLI up to date if requested (bun only)
if [[ "$CODEX_AUTO_UPDATE" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[codex] updating via bun..."
    script -q -e -c "bun add -g @openai/codex@latest" /dev/null || true
  else
    echo "[codex] bun not found, skipping auto-update"
  fi
fi

# 2) Auto-clone repo if not already present
if [[ -n "$REPO_URL" && ! -d "$TARGET_DIR/.git" ]]; then
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
    su - dev -c "GIT_TERMINAL_PROMPT=0 git clone --branch '$REPO_REF' '$AUTH_REPO_URL' '$TARGET_DIR'"
  else
    su - dev -c "GIT_TERMINAL_PROMPT=0 git clone '$AUTH_REPO_URL' '$TARGET_DIR'"
  fi
fi

# 2.5) Ensure GH_TOKEN is available for SSH sessions if provided
if [[ -n "$GH_TOKEN" ]]; then
  printf "export GH_TOKEN=%q
" "$GH_TOKEN" > /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
fi

# 2.6) Configure git identity for the dev user if provided
if [[ -n "$GIT_USER_NAME" ]]; then
  SAFE_GIT_USER_NAME="$(printf "%q" "$GIT_USER_NAME")"
  su - dev -c "git config --global user.name $SAFE_GIT_USER_NAME"
fi

if [[ -n "$GIT_USER_EMAIL" ]]; then
  SAFE_GIT_USER_EMAIL="$(printf "%q" "$GIT_USER_EMAIL")"
  su - dev -c "git config --global user.email $SAFE_GIT_USER_EMAIL"
fi

# 3) Run sshd in foreground
exec /usr/sbin/sshd -D
