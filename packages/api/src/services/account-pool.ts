// CHANGE: add API-level account pool service with persistence and rate-limit monitoring
// WHY: enable automatic switching between registered accounts when one hits API rate limits
// QUOTE(ТЗ): "Сделать возможность регистрировать много аккаунтов codex, claude code и когда на одном лимиты закаончиваются он переходит на другой аккаунт"
// REF: issue-213
// SOURCE: n/a
// FORMAT THEOREM: ∀op ∈ PoolOperation: op(state) → persist(nextState) ∧ consistent(nextState)
// PURITY: SHELL
// EFFECT: Effect<Result, ApiError>
// INVARIANT: pool state is persisted to disk after every mutation; in-memory state is source of truth
// COMPLEXITY: O(n) per operation where n = total accounts

import { defaultProjectsRoot } from "@effect-template/lib/usecases/path-helpers"
import type {
  AccountPoolProvider,
  AccountPoolState,
  AccountEntry,
  RateLimitEvent
} from "@effect-template/lib/core/account-pool-domain"
import {
  addAccount,
  removeAccount,
  markRateLimited,
  clearCooldown,
  selectNextAvailable,
  advanceActiveIndex,
  listAccounts,
  listAllAccounts,
  poolSummary,
  emptyPoolState
} from "@effect-template/lib/usecases/account-pool"
import { detectRateLimit } from "@effect-template/lib/usecases/rate-limit-detector"
import { promises as fs } from "node:fs"
import { join } from "node:path"

let poolState: AccountPoolState = emptyPoolState(new Date().toISOString())
let initialized = false

const nowIso = (): string => new Date().toISOString()

const stateFilePath = (): string =>
  join(defaultProjectsRoot(process.cwd()), ".orch", "state", "account-pool.json")

const persistState = async (): Promise<void> => {
  const filePath = stateFilePath()
  await fs.mkdir(join(filePath, ".."), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(poolState, null, 2), "utf8")
}

const persistBestEffort = (): void => {
  void persistState().catch(() => {
    // best effort
  })
}

export const initializeAccountPool = async (): Promise<void> => {
  if (initialized) {
    return
  }

  const filePath = stateFilePath()
  const exists = await fs.stat(filePath).then(() => true).catch(() => false)
  if (exists) {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as AccountPoolState
    poolState = {
      pools: parsed.pools ?? [],
      updatedAt: parsed.updatedAt ?? nowIso()
    }
  }

  initialized = true
}

export const addPoolAccount = (
  provider: AccountPoolProvider,
  label: string
): AccountPoolState => {
  const now = nowIso()
  poolState = addAccount(poolState, provider, label, now)
  persistBestEffort()
  return poolState
}

export const removePoolAccount = (
  provider: AccountPoolProvider,
  label: string
): AccountPoolState => {
  const now = nowIso()
  poolState = removeAccount(poolState, provider, label, now)
  persistBestEffort()
  return poolState
}

export const markAccountRateLimited = (
  event: RateLimitEvent
): AccountPoolState => {
  const now = nowIso()
  poolState = markRateLimited(poolState, event, now)
  persistBestEffort()
  return poolState
}

export const clearAccountCooldown = (
  provider: AccountPoolProvider,
  label: string
): AccountPoolState => {
  const now = nowIso()
  poolState = clearCooldown(poolState, provider, label, now)
  persistBestEffort()
  return poolState
}

export const selectNextPoolAccount = (
  provider: AccountPoolProvider
): AccountEntry | undefined => {
  const now = nowIso()
  const account = selectNextAvailable(poolState, provider, now)
  if (account !== undefined) {
    poolState = advanceActiveIndex(poolState, provider, now)
    persistBestEffort()
  }
  return account
}

export const listPoolAccounts = (
  provider: AccountPoolProvider
): ReadonlyArray<AccountEntry> =>
  listAccounts(poolState, provider)

export const listAllPoolAccounts = (): ReadonlyArray<AccountEntry> =>
  listAllAccounts(poolState)

export const getPoolSummary = (
  provider: AccountPoolProvider
): {
  readonly total: number
  readonly available: number
  readonly coolingDown: number
  readonly activeLabel: string | undefined
} => poolSummary(poolState, provider, nowIso())

export const getPoolState = (): AccountPoolState => poolState

/**
 * Check an agent output line for rate-limit signals.
 * If a rate-limit is detected, marks the account as rate-limited
 * and returns the event for the caller to act upon.
 *
 * @effect mutates poolState on detection
 */
export const checkLineForRateLimit = (
  provider: AccountPoolProvider,
  label: string,
  line: string
): RateLimitEvent | undefined => {
  const now = nowIso()
  const event = detectRateLimit(provider, label, line, now)
  if (event !== undefined) {
    markAccountRateLimited(event)
  }
  return event
}
