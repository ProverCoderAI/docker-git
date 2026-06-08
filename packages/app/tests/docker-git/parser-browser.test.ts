import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { parseOrThrow } from "./parser-helpers.js"

describe("parseArgs browser frontend", () => {
  it.effect("parses browser aliases", () =>
    Effect.sync(() => {
      expect(parseOrThrow(["browser"])).toEqual({ _tag: "Browser", daemon: false })
      expect(parseOrThrow(["web"])).toEqual({ _tag: "Browser", daemon: false })
    }))

  it.effect("parses browser daemon mode", () =>
    Effect.sync(() => {
      expect(parseOrThrow(["browser", "-d"])).toEqual({ _tag: "Browser", daemon: true })
      expect(parseOrThrow(["web", "--daemon"])).toEqual({ _tag: "Browser", daemon: true })
    }))
})
