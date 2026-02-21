import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { uiHtml, uiScript, uiStyles } from "../src/ui.js"

describe("api ui wrapper", () => {
  it.effect("contains basic shell and API hooks", () =>
    Effect.sync(() => {
      expect(uiHtml).toContain("docker-git API Console")
      expect(uiHtml).toContain("/ui/app.js")
      expect(uiScript).toContain("/v1/projects")
      expect(uiStyles).toContain(".panel")
    }))
})
