import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { findAvailablePort } from "../../src/server/core/ports.js"

describe("findAvailablePort", () => {
  it.effect("returns preferred when free", () =>
    Effect.sync(() => {
      const port = findAvailablePort(2222, [2223, 2224], { min: 2222, max: 2230 })
      expect(port).toBe(2222)
    }))

  it.effect("selects next free port in range", () =>
    Effect.sync(() => {
      const port = findAvailablePort(2222, [2222, 2223], { min: 2222, max: 2225 })
      expect(port).toBe(2224)
    }))

  it.effect("wraps around when needed", () =>
    Effect.sync(() => {
      const port = findAvailablePort(2224, [2224, 2225], { min: 2222, max: 2225 })
      expect(port).toBe(2222)
    }))
})
