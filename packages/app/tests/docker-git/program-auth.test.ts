import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { isRoutedAuthCommand } from "../../src/docker-git/program-auth.js"

describe("program auth routing", () => {
  it.effect("routes Claude status through the controller in host API mode", () =>
    Effect.sync(() => {
      expect(
        isRoutedAuthCommand({
          _tag: "AuthClaudeStatus",
          label: null,
          claudeAuthPath: ".docker-git/.orch/auth/claude"
        })
      ).toBe(true)
    }))
})
