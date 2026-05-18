import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { parseOrThrow } from "./parser-helpers.js"

describe("parseArgs browser frontend", () => {
  it.effect("parses browser aliases", () =>
    Effect.sync(() => {
      expect(parseOrThrow(["browser"])._tag).toBe("Browser")
      expect(parseOrThrow(["web"])._tag).toBe("Browser")
    }))
})
