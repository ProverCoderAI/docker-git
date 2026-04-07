// CHANGE: add multi-account pool domain types for rate-limit failover
// WHY: enable automatic switching between registered accounts when one hits API rate limits
// QUOTE(ТЗ): "Сделать возможность регистрировать много аккаунтов codex, claude code и когда на одном лимиты закаончиваются он переходит на другой аккаунт"
// REF: issue-213
// SOURCE: n/a
// FORMAT THEOREM: ∀pool ∈ AccountPool: |pool.accounts| > 0 → ∃a ∈ pool.accounts: available(a)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: account labels are unique within a pool; cooldown timestamps are monotonically increasing
// COMPLEXITY: O(1) for type definitions

/**
 * Supported AI agent provider identifiers for account pooling.
 *
 * @pure true
 * @invariant provider ∈ {"claude", "codex", "gemini"}
 */
export type AccountPoolProvider = "claude" | "codex" | "gemini"

/**
 * A single registered account entry within a provider pool.
 *
 * @pure true
 * @invariant label is normalized (lowercase, hyphen-separated)
 * @invariant cooldownUntil is either undefined (available) or an ISO-8601 timestamp
 */
export interface AccountEntry {
  readonly label: string
  readonly provider: AccountPoolProvider
  readonly addedAt: string
  readonly cooldownUntil: string | undefined
  readonly consecutiveFailures: number
}

/**
 * Describes a rate-limit event detected for an account.
 *
 * @pure true
 * @invariant detectedAt is an ISO-8601 timestamp
 * @invariant cooldownMs > 0
 */
export interface RateLimitEvent {
  readonly provider: AccountPoolProvider
  readonly label: string
  readonly detectedAt: string
  readonly cooldownMs: number
  readonly reason: string
}

/**
 * The account pool state for a single provider.
 *
 * @pure true
 * @invariant accounts.length >= 0
 * @invariant activeIndex < accounts.length when accounts.length > 0
 */
export interface ProviderAccountPool {
  readonly provider: AccountPoolProvider
  readonly accounts: ReadonlyArray<AccountEntry>
  readonly activeIndex: number
}

/**
 * Full account pool state across all providers.
 *
 * @pure true
 * @invariant each provider has at most one pool
 */
export interface AccountPoolState {
  readonly pools: ReadonlyArray<ProviderAccountPool>
  readonly updatedAt: string
}

/**
 * Known rate-limit output patterns for each provider.
 * Each pattern is a regex string that matches rate-limit messages in agent stdout/stderr.
 *
 * @pure true
 * @invariant patterns are valid regex strings
 * @complexity O(1)
 */
export const rateLimitPatterns: ReadonlyArray<{
  readonly provider: AccountPoolProvider
  readonly pattern: RegExp
  readonly defaultCooldownMs: number
}> = [
  {
    provider: "claude",
    pattern: /rate.?limit|too many requests|429|quota.?exceeded|usage.?limit|capacity|throttl/i,
    defaultCooldownMs: 5 * 60 * 1000
  },
  {
    provider: "codex",
    pattern: /rate.?limit|too many requests|429|quota.?exceeded|usage.?limit|throttl/i,
    defaultCooldownMs: 5 * 60 * 1000
  },
  {
    provider: "gemini",
    pattern: /rate.?limit|too many requests|429|quota.?exceeded|resource.?exhausted|throttl/i,
    defaultCooldownMs: 5 * 60 * 1000
  }
]
