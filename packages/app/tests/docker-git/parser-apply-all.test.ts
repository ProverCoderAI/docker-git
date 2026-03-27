import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { parseOrThrow } from "./parser-helpers.js"

const assertApplyAllActiveOnly = (args: ReadonlyArray<string>, expectedActiveOnly: boolean) => {
  const command = parseOrThrow(args)
  expect(command._tag).toBe("ApplyAll")
  if (command._tag === "ApplyAll") {
    expect(command.activeOnly).toBe(expectedActiveOnly)
  }
}

describe("parseArgs apply-all --active", () => {
  it.effect("parses apply-all without --active as activeOnly=false", () =>
    Effect.sync(() => {
      assertApplyAllActiveOnly(["apply-all"], false)
    }))

  it.effect("parses update-all without --active as activeOnly=false", () =>
    Effect.sync(() => {
      assertApplyAllActiveOnly(["update-all"], false)
    }))

  it.effect("parses apply-all with --active as activeOnly=true", () =>
    Effect.sync(() => {
      assertApplyAllActiveOnly(["apply-all", "--active"], true)
    }))

  it.effect("parses update-all with --active as activeOnly=true", () =>
    Effect.sync(() => {
      assertApplyAllActiveOnly(["update-all", "--active"], true)
    }))
})
