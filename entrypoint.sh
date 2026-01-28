#!/usr/bin/env bash
# CHANGE: bootstrap sshd + optional git clone at container start
# WHY: keep all IO side effects in a single shell boundary
# QUOTE(TZ): n/a
# REF: user-request-2026-01-07
# SOURCE: n/a
# FORMAT THEOREM: forall env: (REPO_URL != "" && !git(TARGET_DIR)) -> cloned(REPO_URL, TARGET_DIR)
# PURITY: SHELL
# EFFECT: Effect<sshd, CloneError | IO, Env>
# INVARIANT: sshd runs in foreground after optional clone
# COMPLEXITY: O(network + repo_size)
set -euo pipefail

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-}"
TARGET_DIR="${TARGET_DIR:-/work/app}"

# 1) Authorized keys are mounted from host at /authorized_keys
mkdir -p /home/dev/.ssh
chmod 700 /home/dev/.ssh

if [[ -f /authorized_keys ]]; then
  cp /authorized_keys /home/dev/.ssh/authorized_keys
  chmod 600 /home/dev/.ssh/authorized_keys
fi

chown -R dev:dev /home/dev/.ssh

# Ensure Codex home exists if mounted
mkdir -p /home/dev/.codex
chown -R dev:dev /home/dev/.codex

# 2) Auto-clone repo if not already present
if [[ -n "$REPO_URL" && ! -d "$TARGET_DIR/.git" ]]; then
  mkdir -p "$TARGET_DIR"
  chown -R dev:dev /home/dev

  if [[ -n "$REPO_REF" ]]; then
    su - dev -c "git clone --branch '$REPO_REF' '$REPO_URL' '$TARGET_DIR'"
  else
    su - dev -c "git clone '$REPO_URL' '$TARGET_DIR'"
  fi
fi

# 3) Run sshd in foreground
exec /usr/sbin/sshd -D
