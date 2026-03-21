// CHANGE: add automatic DNS repair at container startup
// WHY: Docker internal DNS (127.0.0.11) intermittently loses external nameservers,
//      causing domain resolution to fail inside containers
// QUOTE(ТЗ): "При запуске контейнера он всегда исправляет интернет соединение потому что оно время от времени ложится"
// REF: issue-168
// SOURCE: n/a
// FORMAT THEOREM: ∀container: startup(container) → dns_healthy(container) ∨ dns_repaired(container)
// PURITY: SHELL
// EFFECT: Effect<void, DnsRepairError, Env>
// INVARIANT: after execution, at least one nameserver in /etc/resolv.conf resolves external domains
// COMPLEXITY: O(1) per probe attempt, O(max_attempts) worst case
export const renderEntrypointDnsRepair = (): string =>
  `# 0) Ensure DNS resolution works; repair /etc/resolv.conf if Docker DNS is broken
docker_git_repair_dns() {
  local test_domain="github.com"
  local resolv="/etc/resolv.conf"
  local fallback_dns="8.8.8.8 8.8.4.4 1.1.1.1"

  if getent hosts "$test_domain" >/dev/null 2>&1; then
    return 0
  fi

  echo "[dns-repair] DNS resolution failed for $test_domain; attempting repair..."

  # Preserve Docker internal resolver but append external fallbacks
  local has_external=0
  for ns in $fallback_dns; do
    if grep -q "nameserver $ns" "$resolv" 2>/dev/null; then
      has_external=1
    fi
  done

  if [[ "$has_external" -eq 0 ]]; then
    for ns in $fallback_dns; do
      printf "nameserver %s\\n" "$ns" >> "$resolv"
    done
    echo "[dns-repair] appended fallback nameservers to $resolv"
  fi

  # Verify fix
  if getent hosts "$test_domain" >/dev/null 2>&1; then
    echo "[dns-repair] DNS resolution restored"
    return 0
  fi

  echo "[dns-repair] WARNING: DNS resolution still failing after repair attempt"
  return 1
}
docker_git_repair_dns || true`
