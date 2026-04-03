import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { renderJsonPayload } from "../../src/docker-git/api-json.js"

describe("api-json render", () => {
  it.effect("renders nested status message for codex status payloads", () =>
    Effect.sync(() => {
      const rendered = renderJsonPayload({
        status: {
          label: "default",
          message: "Codex auth imported into controller state (account: ci@example.com).",
          present: true,
          authPath: "/home/dev/.docker-git/.orch/auth/codex/auth.json",
          account: "ci@example.com"
        }
      })

      expect(rendered).toBe("Codex auth imported into controller state (account: ci@example.com).")
    }))
})
