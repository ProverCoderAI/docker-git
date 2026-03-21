import { describe, expect, it } from "@effect/vitest"

import {
  isGithubHttpsRemote,
  normalizeGithubHttpsRemote,
  requiresGithubAuthHint,
  tryBuildGithubCompareUrl
} from "../../src/usecases/state-repo/github-auth.js"

describe("state-repo github auth helpers", () => {
  it("treats https remotes with embedded user info as GitHub https remotes", () => {
    expect(isGithubHttpsRemote("https://x-access-token@github.com/acme/demo.git")).toBe(true)
  })

  it("normalizes https remotes with embedded user info to the canonical GitHub URL", () => {
    expect(normalizeGithubHttpsRemote("https://x-access-token@github.com/acme/demo.git")).toBe(
      "https://github.com/acme/demo.git"
    )
  })

  it("keeps compare URL generation working for https remotes with embedded user info", () => {
    expect(tryBuildGithubCompareUrl("https://x-access-token@github.com/acme/demo.git", "main", "feature/fix")).toBe(
      "https://github.com/acme/demo/compare/main...feature%2Ffix?expand=1"
    )
  })

  it("requires an auth hint only for GitHub https remotes without a usable token", () => {
    expect(requiresGithubAuthHint("https://github.com/acme/demo.git", null)).toBe(true)
    expect(requiresGithubAuthHint("https://github.com/acme/demo.git", "   ")).toBe(true)
    expect(requiresGithubAuthHint("https://github.com/acme/demo.git", "ghp_valid")).toBe(false)
    expect(requiresGithubAuthHint("git@github.com:acme/demo.git", null)).toBe(false)
  })
})
