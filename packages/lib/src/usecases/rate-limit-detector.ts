// CHANGE: add rate-limit detection for agent output streams
// WHY: detect when an AI agent hits API rate limits to trigger automatic account switching
// QUOTE(ТЗ): "когда на одном лимиты закаончиваются он переходит на другой аккаунт"
// REF: issue-213
// SOURCE: n/a
// FORMAT THEOREM: ∀line ∈ Output: detectRateLimit(provider, line) = Some(event) ↔ ∃pattern: pattern.test(line)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: detection is stateless per line; no false positives on normal operational messages
// COMPLEXITY: O(p) where p = number of patterns per provider

import type { AccountPoolProvider, RateLimitEvent } from "../core/account-pool-domain.js"
import { rateLimitPatterns } from "../core/account-pool-domain.js"

/**
 * Attempt to detect a rate-limit event from an agent output line.
 * Returns a RateLimitEvent if the line matches a known rate-limit pattern, undefined otherwise.
 *
 * @pure true
 * @precondition line.length > 0
 * @postcondition result !== undefined → result.provider === provider ∧ result.label === label
 * @invariant detection is deterministic given the same inputs
 * @complexity O(p) where p = number of patterns for the provider
 */
export const detectRateLimit = (
  provider: AccountPoolProvider,
  label: string,
  line: string,
  now: string
): RateLimitEvent | undefined => {
  for (const entry of rateLimitPatterns) {
    if (entry.provider !== provider) {
      continue
    }
    if (entry.pattern.test(line)) {
      return {
        provider,
        label,
        detectedAt: now,
        cooldownMs: entry.defaultCooldownMs,
        reason: line.slice(0, 200)
      }
    }
  }
  return undefined
}

/**
 * Check multiple lines for rate-limit signals.
 * Returns the first detected event or undefined.
 *
 * @pure true
 * @complexity O(n * p) where n = number of lines
 */
export const detectRateLimitInLines = (
  provider: AccountPoolProvider,
  label: string,
  lines: ReadonlyArray<string>,
  now: string
): RateLimitEvent | undefined => {
  for (const line of lines) {
    const event = detectRateLimit(provider, label, line, now)
    if (event !== undefined) {
      return event
    }
  }
  return undefined
}
