import { describe, expect, it } from "@effect/vitest"

import { detectRateLimit, detectRateLimitInLines } from "../../src/usecases/rate-limit-detector.js"

const now = "2026-04-07T12:00:00.000Z"

describe("rate-limit-detector", () => {
  describe("detectRateLimit", () => {
    it("detects Claude rate limit message", () => {
      const event = detectRateLimit("claude", "account-1", "Error: rate limit exceeded for this account", now)
      expect(event).not.toBeUndefined()
      expect(event?.provider).toBe("claude")
      expect(event?.label).toBe("account-1")
      expect(event?.cooldownMs).toBe(5 * 60 * 1000)
    })

    it("detects 429 status code", () => {
      const event = detectRateLimit("codex", "default", "HTTP 429 Too Many Requests", now)
      expect(event).not.toBeUndefined()
      expect(event?.provider).toBe("codex")
    })

    it("detects quota exceeded", () => {
      const event = detectRateLimit("claude", "a", "Your quota exceeded for this billing period", now)
      expect(event).not.toBeUndefined()
    })

    it("detects usage limit", () => {
      const event = detectRateLimit("claude", "a", "Usage limit reached", now)
      expect(event).not.toBeUndefined()
    })

    it("detects throttling", () => {
      const event = detectRateLimit("codex", "a", "Request throttled", now)
      expect(event).not.toBeUndefined()
    })

    it("does not detect normal messages", () => {
      const event = detectRateLimit("claude", "a", "Successfully completed task", now)
      expect(event).toBeUndefined()
    })

    it("does not detect empty lines", () => {
      const event = detectRateLimit("claude", "a", "", now)
      expect(event).toBeUndefined()
    })

    it("detects Gemini resource exhausted", () => {
      const event = detectRateLimit("gemini", "a", "RESOURCE_EXHAUSTED: quota exceeded", now)
      expect(event).not.toBeUndefined()
    })

    it("truncates long reason strings", () => {
      const longLine = "rate limit " + "x".repeat(300)
      const event = detectRateLimit("claude", "a", longLine, now)
      expect(event).not.toBeUndefined()
      expect(event!.reason.length).toBeLessThanOrEqual(200)
    })
  })

  describe("detectRateLimitInLines", () => {
    it("finds rate limit in multiple lines", () => {
      const lines = [
        "Starting agent...",
        "Processing task...",
        "Error: 429 Too Many Requests",
        "Shutting down..."
      ]
      const event = detectRateLimitInLines("claude", "a", lines, now)
      expect(event).not.toBeUndefined()
    })

    it("returns undefined when no rate limit found", () => {
      const lines = [
        "Starting agent...",
        "Processing task...",
        "Task completed successfully"
      ]
      const event = detectRateLimitInLines("claude", "a", lines, now)
      expect(event).toBeUndefined()
    })

    it("returns the first match", () => {
      const lines = [
        "rate limit on account",
        "429 error"
      ]
      const event = detectRateLimitInLines("claude", "a", lines, now)
      expect(event).not.toBeUndefined()
      expect(event?.reason).toContain("rate limit")
    })
  })
})
