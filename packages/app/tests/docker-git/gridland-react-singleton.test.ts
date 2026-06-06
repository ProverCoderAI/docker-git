import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import rootPackage from "../../../../package.json" with { type: "json" }
import appPackage from "../../package.json" with { type: "json" }

describe("Gridland React singleton contract", () => {
  it.effect("pins React across workspace dependencies for the Gridland renderer", () =>
    Effect.sync(() => {
      expect(rootPackage.overrides.react).toBe(appPackage.dependencies.react.replace(/^\^/u, ""))
    }))
})
