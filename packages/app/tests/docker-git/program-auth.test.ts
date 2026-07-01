import { describe, expect, it } from "vitest"

import { isRoutedAuthCommand } from "../../src/docker-git/program-auth.js"

describe("program auth routing", () => {
  it("routes Claude status through the controller in host API mode", () => {
    expect(
      isRoutedAuthCommand({
        _tag: "AuthClaudeStatus",
        label: null,
        claudeAuthPath: ".docker-git/.orch/auth/claude"
      })
    ).toBe(true)
  })
})
