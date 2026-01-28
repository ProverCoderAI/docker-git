import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { formatGreeting, type GreetingVariant } from "../../src/core/greeting.js"

describe("formatGreeting", () => {
  it.effect("returns default Effect greeting for effect variant", () =>
    Effect.sync(() => {
      const variant: GreetingVariant = { kind: "effect" }
      const result = formatGreeting(variant)
      expect(result).toBe("Hello from Effect!")
    }))

  it.effect("formats deterministic greeting for named variant", () =>
    Effect.sync(() => {
      const variant: GreetingVariant = { kind: "named", name: "Alice" }
      const result = formatGreeting(variant)
      expect(result).toBe("Hello, Alice!")
    }))
})
