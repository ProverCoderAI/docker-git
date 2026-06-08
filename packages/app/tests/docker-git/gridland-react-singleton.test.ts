import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import rootPackage from "../../../../package.json" with { type: "json" }
import terminalPackage from "../../../terminal/package.json" with { type: "json" }
import appPackage from "../../package.json" with { type: "json" }

// CHANGE: encode the React version resolved for the Gridland Bun renderer.
// WHY: @gridland/bun embeds react-reconciler@0.33.0; Bun resolves that renderer contract to React 19.2.4.
// QUOTE(ISSUE): "TypeError: null is not an object (evaluating 'resolveDispatcher().useCallback')"
// REF: issue-385
// SOURCE: n/a
// FORMAT THEOREM: workspaceReactVersion = rendererReactVersion -> dispatcher(hookCall) != null
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: every workspace React entry resolves to the renderer-compatible singleton version.
// COMPLEXITY: O(1)
const gridlandRendererReactVersion = "19.2.4"

const stripCaret = (value: string): string => value.replace(/^\^/u, "")

describe("Gridland React singleton contract", () => {
  it.effect("pins React across workspace dependencies for the Gridland renderer", () =>
    Effect.sync(() => {
      expect(rootPackage.overrides.react).toBe(gridlandRendererReactVersion)
      expect(rootPackage.overrides["react-dom"]).toBe(gridlandRendererReactVersion)
      expect(stripCaret(appPackage.dependencies.react)).toBe(gridlandRendererReactVersion)
      expect(stripCaret(appPackage.dependencies["react-dom"])).toBe(gridlandRendererReactVersion)
      expect(stripCaret(terminalPackage.dependencies.react)).toBe(gridlandRendererReactVersion)
      expect(stripCaret(terminalPackage.devDependencies["react-dom"])).toBe(gridlandRendererReactVersion)
    }))
})
