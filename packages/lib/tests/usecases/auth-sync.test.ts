import { describe, expect, it } from "@effect/vitest"

import { syncGithubAuthKeys } from "../../src/usecases/auth-sync.js"

describe("syncGithubAuthKeys", () => {
  it("updates github token keys from source and preserves non-auth target keys", () => {
    const source = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_new",
      "GITHUB_TOKEN__WORK=token_work",
      "SOME_SOURCE_ONLY=value",
      ""
    ].join("\n")
    const target = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_old",
      "GH_TOKEN=legacy_old",
      "CUSTOM_FLAG=1",
      ""
    ].join("\n")

    const next = syncGithubAuthKeys(source, target)

    expect(next).toContain("GITHUB_TOKEN=token_new")
    expect(next).toContain("GITHUB_TOKEN__WORK=token_work")
    expect(next).not.toContain("GH_TOKEN=legacy_old")
    expect(next).toContain("CUSTOM_FLAG=1")
  })

  it("keeps target unchanged when source has no github token keys", () => {
    const source = [
      "# docker-git env",
      "# KEY=value",
      "UNRELATED=1",
      ""
    ].join("\n")
    const target = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_old",
      "CUSTOM_FLAG=1",
      ""
    ].join("\n")

    const next = syncGithubAuthKeys(source, target)

    expect(next).toBe(target)
  })
})
