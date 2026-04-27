import { describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectParseErrorTag } from "./parser-helpers.js"

describe("parseArgs session sync removal", () => {
  it.effect("rejects removed session-gists commands", () =>
    Effect.gen(function*(_) {
      yield* _(expectParseErrorTag(["session-gists"], "UnknownCommand"))
      yield* _(expectParseErrorTag(["gists"], "UnknownCommand"))
    }))
})
