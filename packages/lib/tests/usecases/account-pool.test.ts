import { describe, expect, it } from "@effect/vitest"

import type { AccountPoolState, RateLimitEvent } from "../../src/core/account-pool-domain.js"
import {
  addAccount,
  advanceActiveIndex,
  clearCooldown,
  emptyPoolState,
  isAccountCoolingDown,
  listAccounts,
  listAllAccounts,
  markRateLimited,
  poolSummary,
  removeAccount,
  selectNextAvailable
} from "../../src/usecases/account-pool.js"

const now = "2026-04-07T12:00:00.000Z"
const later = "2026-04-07T12:10:00.000Z"
const pastCooldown = "2026-04-07T12:06:00.000Z"

describe("account-pool", () => {
  describe("emptyPoolState", () => {
    it("creates an empty state", () => {
      const state = emptyPoolState(now)
      expect(state.pools).toEqual([])
      expect(state.updatedAt).toBe(now)
    })
  })

  describe("addAccount", () => {
    it("adds a new account to an empty pool", () => {
      const state = addAccount(emptyPoolState(now), "claude", "account-1", now)
      const accounts = listAccounts(state, "claude")
      expect(accounts).toHaveLength(1)
      expect(accounts[0]?.label).toBe("account-1")
      expect(accounts[0]?.provider).toBe("claude")
      expect(accounts[0]?.cooldownUntil).toBeUndefined()
      expect(accounts[0]?.consecutiveFailures).toBe(0)
    })

    it("does not add duplicate labels", () => {
      let state = addAccount(emptyPoolState(now), "claude", "account-1", now)
      state = addAccount(state, "claude", "account-1", now)
      expect(listAccounts(state, "claude")).toHaveLength(1)
    })

    it("normalizes labels", () => {
      const state = addAccount(emptyPoolState(now), "claude", "My Account!", now)
      const accounts = listAccounts(state, "claude")
      expect(accounts[0]?.label).toBe("my-account")
    })

    it("adds accounts to different providers independently", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "codex", "b", now)
      expect(listAccounts(state, "claude")).toHaveLength(1)
      expect(listAccounts(state, "codex")).toHaveLength(1)
    })
  })

  describe("removeAccount", () => {
    it("removes an existing account", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      state = removeAccount(state, "claude", "a", now)
      expect(listAccounts(state, "claude")).toHaveLength(1)
      expect(listAccounts(state, "claude")[0]?.label).toBe("b")
    })

    it("is a no-op for non-existent accounts", () => {
      const state = addAccount(emptyPoolState(now), "claude", "a", now)
      const next = removeAccount(state, "claude", "nonexistent", now)
      expect(listAccounts(next, "claude")).toHaveLength(1)
    })
  })

  describe("markRateLimited", () => {
    it("sets cooldown and increments failure count", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit exceeded"
      }
      state = markRateLimited(state, event, now)
      const accounts = listAccounts(state, "claude")
      expect(accounts[0]?.cooldownUntil).toBe("2026-04-07T12:05:00.000Z")
      expect(accounts[0]?.consecutiveFailures).toBe(1)
    })
  })

  describe("isAccountCoolingDown", () => {
    it("returns true when cooldown is in the future", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const account = listAccounts(state, "claude")[0]!
      expect(isAccountCoolingDown(account, now)).toBe(true)
    })

    it("returns false when cooldown has expired", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const account = listAccounts(state, "claude")[0]!
      expect(isAccountCoolingDown(account, pastCooldown)).toBe(false)
    })

    it("returns false when no cooldown is set", () => {
      const state = addAccount(emptyPoolState(now), "claude", "a", now)
      const account = listAccounts(state, "claude")[0]!
      expect(isAccountCoolingDown(account, now)).toBe(false)
    })
  })

  describe("clearCooldown", () => {
    it("resets cooldown and failure count", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      state = clearCooldown(state, "claude", "a", later)
      const account = listAccounts(state, "claude")[0]!
      expect(account.cooldownUntil).toBeUndefined()
      expect(account.consecutiveFailures).toBe(0)
    })
  })

  describe("selectNextAvailable", () => {
    it("returns the first available account", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      const account = selectNextAvailable(state, "claude", now)
      expect(account?.label).toBe("a")
    })

    it("skips rate-limited accounts", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const account = selectNextAvailable(state, "claude", now)
      expect(account?.label).toBe("b")
    })

    it("returns undefined when all accounts are cooling down", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const account = selectNextAvailable(state, "claude", now)
      expect(account).toBeUndefined()
    })

    it("returns undefined for empty pool", () => {
      const state = emptyPoolState(now)
      const account = selectNextAvailable(state, "claude", now)
      expect(account).toBeUndefined()
    })

    it("returns expired-cooldown account when cooldown has passed", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const account = selectNextAvailable(state, "claude", pastCooldown)
      expect(account?.label).toBe("a")
    })
  })

  describe("advanceActiveIndex", () => {
    it("advances to the next account", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      state = addAccount(state, "claude", "c", now)
      state = advanceActiveIndex(state, "claude", now)

      // After advancing, the next available should start from index 1
      const account = selectNextAvailable(state, "claude", now)
      expect(account?.label).toBe("b")
    })

    it("wraps around to the beginning", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      state = advanceActiveIndex(state, "claude", now)
      state = advanceActiveIndex(state, "claude", now)
      const account = selectNextAvailable(state, "claude", now)
      expect(account?.label).toBe("a")
    })
  })

  describe("listAllAccounts", () => {
    it("lists accounts across all providers", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "codex", "b", now)
      state = addAccount(state, "gemini", "c", now)
      const all = listAllAccounts(state)
      expect(all).toHaveLength(3)
      expect(all.map((a) => a.label).sort()).toEqual(["a", "b", "c"])
    })
  })

  describe("poolSummary", () => {
    it("summarizes pool state correctly", () => {
      let state = addAccount(emptyPoolState(now), "claude", "a", now)
      state = addAccount(state, "claude", "b", now)
      state = addAccount(state, "claude", "c", now)
      const event: RateLimitEvent = {
        provider: "claude",
        label: "a",
        detectedAt: now,
        cooldownMs: 5 * 60 * 1000,
        reason: "rate limit"
      }
      state = markRateLimited(state, event, now)
      const summary = poolSummary(state, "claude", now)
      expect(summary.total).toBe(3)
      expect(summary.available).toBe(2)
      expect(summary.coolingDown).toBe(1)
      expect(summary.activeLabel).toBe("a")
    })
  })
})
