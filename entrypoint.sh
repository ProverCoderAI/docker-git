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

# 0) Ensure DNS resolution works; repair /etc/resolv.conf if Docker DNS is broken
docker_git_repair_dns() {
  local test_domain="github.com"
  local resolv="/etc/resolv.conf"
  local fallback_dns="8.8.8.8 8.8.4.4 1.1.1.1"

  if getent hosts "$test_domain" >/dev/null 2>&1; then
    return 0
  fi

  echo "[dns-repair] DNS resolution failed for $test_domain; attempting repair..."

  local has_external=0
  for ns in $fallback_dns; do
    if grep -q "nameserver $ns" "$resolv" 2>/dev/null; then
      has_external=1
    fi
  done

  if [[ "$has_external" -eq 0 ]]; then
    for ns in $fallback_dns; do
      printf "nameserver %s\n" "$ns" >> "$resolv"
    done
    echo "[dns-repair] appended fallback nameservers to $resolv"
  fi

  if getent hosts "$test_domain" >/dev/null 2>&1; then
    echo "[dns-repair] DNS resolution restored"
    return 0
  fi

  echo "[dns-repair] WARNING: DNS resolution still failing after repair attempt"
  return 1
}
docker_git_repair_dns || true

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
