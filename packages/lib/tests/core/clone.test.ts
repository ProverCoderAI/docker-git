import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { resolveCloneRequest } from "../../src/core/clone.js"

describe("resolveCloneRequest", () => {
  it.effect("parses clone from argv", () =>
    Effect.sync(() => {
      expect(resolveCloneRequest(["clone", "https://github.com/org/repo.git"], undefined)).toEqual({
        _tag: "Clone",
        args: ["https://github.com/org/repo.git"]
      })
    }))

  it.effect("parses open from argv", () =>
    Effect.sync(() => {
      expect(resolveCloneRequest(["open", "https://github.com/org/repo/issues/7"], undefined)).toEqual({
        _tag: "Open",
        args: ["https://github.com/org/repo/issues/7"]
      })
    }))

  it.effect("parses open from npm lifecycle", () =>
    Effect.sync(() => {
      expect(resolveCloneRequest(["open", "https://github.com/org/repo.git"], "open")).toEqual({
        _tag: "Open",
        args: ["https://github.com/org/repo.git"]
      })
    }))

  it.effect("returns none for unrelated argv", () =>
    Effect.sync(() => {
      expect(resolveCloneRequest(["list"], undefined)).toEqual({
        _tag: "None"
      })
    }))
})
