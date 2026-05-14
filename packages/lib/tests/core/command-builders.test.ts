import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"

import { buildCreateCommand } from "../../src/core/command-builders.js"

describe("buildCreateCommand", () => {
  it("rejects shell metacharacters in sshUser before template rendering", () => {
    const result = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: "dev;touch-pwned"
    })

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toEqual({
        _tag: "InvalidOption",
        option: "--ssh-user",
        reason: "expected Linux user name matching ^[a-z_][a-z0-9_-]{0,31}$"
      })
    }
  })

  it("accepts Linux user names used by generated project configs", () => {
    const result = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: "dev_user-1"
    })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.config.sshUser).toBe("dev_user-1")
    }
  })
})
