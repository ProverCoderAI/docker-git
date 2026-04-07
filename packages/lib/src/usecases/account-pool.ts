// CHANGE: implement multi-account pool management with rate-limit failover
// WHY: enable automatic switching between registered accounts when one hits API rate limits
// QUOTE(ТЗ): "когда на одном лимиты закаончиваются он переходит на другой аккаунт"
// REF: issue-213
// SOURCE: n/a
// FORMAT THEOREM: ∀pool: selectNextAvailable(pool, now) = Some(account) ↔ ∃a ∈ pool.accounts: cooldownUntil(a) < now
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: pool operations are pure; state transitions are deterministic given the same inputs
// COMPLEXITY: O(n) where n = |accounts| per provider

import type {
  AccountEntry,
  AccountPoolProvider,
  AccountPoolState,
  ProviderAccountPool,
  RateLimitEvent
} from "../core/account-pool-domain.js"
import { normalizeAccountLabel } from "./auth-helpers.js"

// CHANGE: create an empty pool state
// WHY: initial state for account pool management
// PURITY: CORE
// COMPLEXITY: O(1)
export const emptyPoolState = (now: string): AccountPoolState => ({
  pools: [],
  updatedAt: now
})

// CHANGE: find or create provider pool within state
// PURITY: CORE
// COMPLEXITY: O(p) where p = number of providers
const findProviderPool = (
  state: AccountPoolState,
  provider: AccountPoolProvider
): ProviderAccountPool =>
  state.pools.find((pool) => pool.provider === provider) ?? {
    provider,
    accounts: [],
    activeIndex: 0
  }

// CHANGE: replace or append provider pool in state
// PURITY: CORE
// COMPLEXITY: O(p)
const upsertProviderPool = (
  state: AccountPoolState,
  pool: ProviderAccountPool,
  now: string
): AccountPoolState => {
  const existing = state.pools.findIndex((p) => p.provider === pool.provider)
  const nextPools = [...state.pools]
  if (existing >= 0) {
    nextPools[existing] = pool
  } else {
    nextPools.push(pool)
  }
  return { pools: nextPools, updatedAt: now }
}

/**
 * Add an account to a provider's pool.
 *
 * @pure true
 * @precondition label.length > 0
 * @postcondition account with normalized label exists in pool
 * @invariant duplicate labels are rejected (returns state unchanged)
 * @complexity O(n) where n = |accounts| in the provider pool
 */
export const addAccount = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  label: string,
  now: string
): AccountPoolState => {
  const normalized = normalizeAccountLabel(label, "default")
  const pool = findProviderPool(state, provider)

  const exists = pool.accounts.some((account) => account.label === normalized)
  if (exists) {
    return state
  }

  const entry: AccountEntry = {
    label: normalized,
    provider,
    addedAt: now,
    cooldownUntil: undefined,
    consecutiveFailures: 0
  }

  const nextPool: ProviderAccountPool = {
    ...pool,
    accounts: [...pool.accounts, entry]
  }

  return upsertProviderPool(state, nextPool, now)
}

/**
 * Remove an account from a provider's pool.
 *
 * @pure true
 * @postcondition account with normalized label does not exist in pool
 * @complexity O(n)
 */
export const removeAccount = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  label: string,
  now: string
): AccountPoolState => {
  const normalized = normalizeAccountLabel(label, "default")
  const pool = findProviderPool(state, provider)

  const nextAccounts = pool.accounts.filter((account) => account.label !== normalized)
  if (nextAccounts.length === pool.accounts.length) {
    return state
  }

  const nextActiveIndex = pool.activeIndex >= nextAccounts.length
    ? 0
    : pool.activeIndex

  return upsertProviderPool(
    state,
    { ...pool, accounts: nextAccounts, activeIndex: nextActiveIndex },
    now
  )
}

/**
 * Mark an account as rate-limited with a cooldown period.
 *
 * @pure true
 * @postcondition account.cooldownUntil = event.detectedAt + event.cooldownMs
 * @postcondition account.consecutiveFailures incremented by 1
 * @complexity O(n)
 */
export const markRateLimited = (
  state: AccountPoolState,
  event: RateLimitEvent,
  now: string
): AccountPoolState => {
  const pool = findProviderPool(state, event.provider)

  const nextAccounts = pool.accounts.map((account) => {
    if (account.label !== event.label) {
      return account
    }
    const cooldownUntil = new Date(
      new Date(event.detectedAt).getTime() + event.cooldownMs
    ).toISOString()
    return {
      ...account,
      cooldownUntil,
      consecutiveFailures: account.consecutiveFailures + 1
    }
  })

  return upsertProviderPool(state, { ...pool, accounts: nextAccounts }, now)
}

/**
 * Clear rate-limit cooldown for an account (e.g., after successful use).
 *
 * @pure true
 * @postcondition account.cooldownUntil = undefined, consecutiveFailures = 0
 * @complexity O(n)
 */
export const clearCooldown = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  label: string,
  now: string
): AccountPoolState => {
  const normalized = normalizeAccountLabel(label, "default")
  const pool = findProviderPool(state, provider)

  const nextAccounts = pool.accounts.map((account) =>
    account.label === normalized
      ? { ...account, cooldownUntil: undefined, consecutiveFailures: 0 }
      : account
  )

  return upsertProviderPool(state, { ...pool, accounts: nextAccounts }, now)
}

/**
 * Check if an account is currently under cooldown.
 *
 * @pure true
 * @invariant returns true iff cooldownUntil > now
 * @complexity O(1)
 */
export const isAccountCoolingDown = (account: AccountEntry, now: string): boolean => {
  if (account.cooldownUntil === undefined) {
    return false
  }
  return new Date(account.cooldownUntil).getTime() > new Date(now).getTime()
}

/**
 * Select the next available account from the provider pool.
 * Skips accounts that are still under cooldown.
 * Returns undefined if no available account exists.
 *
 * @pure true
 * @postcondition result !== undefined → ¬isAccountCoolingDown(result, now)
 * @complexity O(n)
 */
export const selectNextAvailable = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  now: string
): AccountEntry | undefined => {
  const pool = findProviderPool(state, provider)
  if (pool.accounts.length === 0) {
    return undefined
  }

  const count = pool.accounts.length
  for (let offset = 0; offset < count; offset++) {
    const index = (pool.activeIndex + offset) % count
    const account = pool.accounts[index]
    if (account !== undefined && !isAccountCoolingDown(account, now)) {
      return account
    }
  }

  return undefined
}

/**
 * Advance the active index to the next account in the pool (round-robin).
 * Called after selecting an account so the next selection starts from the following entry.
 *
 * @pure true
 * @postcondition pool.activeIndex = (pool.activeIndex + 1) % pool.accounts.length
 * @complexity O(p)
 */
export const advanceActiveIndex = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  now: string
): AccountPoolState => {
  const pool = findProviderPool(state, provider)
  if (pool.accounts.length === 0) {
    return state
  }

  const nextIndex = (pool.activeIndex + 1) % pool.accounts.length
  return upsertProviderPool(state, { ...pool, activeIndex: nextIndex }, now)
}

/**
 * List all accounts for a provider with their current status.
 *
 * @pure true
 * @complexity O(n)
 */
export const listAccounts = (
  state: AccountPoolState,
  provider: AccountPoolProvider
): ReadonlyArray<AccountEntry> =>
  findProviderPool(state, provider).accounts

/**
 * List all accounts across all providers.
 *
 * @pure true
 * @complexity O(n * p)
 */
export const listAllAccounts = (
  state: AccountPoolState
): ReadonlyArray<AccountEntry> =>
  state.pools.flatMap((pool) => pool.accounts)

/**
 * Get pool summary for a provider.
 *
 * @pure true
 * @complexity O(n)
 */
export const poolSummary = (
  state: AccountPoolState,
  provider: AccountPoolProvider,
  now: string
): {
  readonly total: number
  readonly available: number
  readonly coolingDown: number
  readonly activeLabel: string | undefined
} => {
  const pool = findProviderPool(state, provider)
  const total = pool.accounts.length
  const coolingDown = pool.accounts.filter((a) => isAccountCoolingDown(a, now)).length
  const available = total - coolingDown
  const activeAccount = pool.accounts[pool.activeIndex]
  return {
    total,
    available,
    coolingDown,
    activeLabel: activeAccount?.label
  }
}
