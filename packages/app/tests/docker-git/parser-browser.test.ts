import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectParseErrorTag, parseOrThrow } from "./parser-helpers.js"

describe("parseArgs browser frontend", () => {
  it.effect("parses browser as the only frontend launch command", () =>
    Effect.sync(() => {
      expect(parseOrThrow(["browser"])._tag).toBe("Browser")
    }))

  it.effect("prints help when no command is provided", () =>
    Effect.sync(() => {
      expect(parseOrThrow([])._tag).toBe("Help")
    }))

  it.effect("rejects removed frontend aliases", () =>
    Effect.all([
      expectParseErrorTag(["menu"], "UnknownCommand"),
      expectParseErrorTag(["ui"], "UnknownCommand"),
      expectParseErrorTag(["web"], "UnknownCommand")
    ]).pipe(Effect.asVoid))
})
