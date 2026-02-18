import { describe, expect, it } from "@effect/vitest"
import { Either, Effect } from "effect"

import { parseMenuSelection } from "../../src/core/menu.js"

describe("parseMenuSelection", () => {
  it.effect("parses auth aliases", () =>
    Effect.sync(() => {
      const byWord = parseMenuSelection("auth")
      const byShort = parseMenuSelection("a")
      const byNumber = parseMenuSelection("3")
      expect(Either.isRight(byWord) && byWord.right._tag === "Auth").toBe(true)
      expect(Either.isRight(byShort) && byShort.right._tag === "Auth").toBe(true)
      expect(Either.isRight(byNumber) && byNumber.right._tag === "Auth").toBe(true)
    }))

  it.effect("parses project auth aliases", () =>
    Effect.sync(() => {
      const byWord = parseMenuSelection("project-auth")
      const byShort = parseMenuSelection("pa")
      const byNumber = parseMenuSelection("4")
      expect(Either.isRight(byWord) && byWord.right._tag === "ProjectAuth").toBe(true)
      expect(Either.isRight(byShort) && byShort.right._tag === "ProjectAuth").toBe(true)
      expect(Either.isRight(byNumber) && byNumber.right._tag === "ProjectAuth").toBe(true)
    }))

  it.effect("keeps quit aliases valid", () =>
    Effect.sync(() => {
      const byZero = parseMenuSelection("0")
      const byEleven = parseMenuSelection("11")
      expect(Either.isRight(byZero) && byZero.right._tag === "Quit").toBe(true)
      expect(Either.isRight(byEleven) && byEleven.right._tag === "Quit").toBe(true)
    }))
})
