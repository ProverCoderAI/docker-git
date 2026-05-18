import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"
import * as fc from "fast-check"

import { buildCreateCommand } from "../../src/core/command-builders.js"

const validFirstChar = "abcdefghijklmnopqrstuvwxyz_".split("")
const validTailChar = "abcdefghijklmnopqrstuvwxyz0123456789_-".split("")

const validSshUserArbitrary = fc
  .tuple(
    fc.constantFrom(...validFirstChar),
    fc.array(fc.constantFrom(...validTailChar), { minLength: 0, maxLength: 31 })
  )
  .map(([first, tail]) => `${first}${tail.join("")}`)

const invalidNonEmptySshUserArbitrary = fc.oneof(
  fc.constantFrom(
    "1dev",
    "-dev",
    "Dev",
    "dev user",
    "dev;touch-pwned",
    "dev$(touch-pwned)",
    "dev`touch-pwned`",
    "dev/foo",
    "dev.foo",
    "dev:foo",
    "dev\nfoo"
  ),
  fc
    .tuple(
      fc.constantFrom(...validFirstChar),
      fc.array(fc.constantFrom(...validTailChar), { minLength: 32, maxLength: 64 })
    )
    .map(([first, tail]) => `${first}${tail.join("")}`)
)

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

  it("preserves generated Linux user names matching the sshUser invariant", () => {
    fc.assert(
      fc.property(validSshUserArbitrary, (sshUser) => {
        const result = buildCreateCommand({
          repoUrl: "https://github.com/org/repo.git",
          sshUser
        })

        expect(Either.isRight(result)).toBe(true)
        if (Either.isRight(result)) {
          expect(result.right.config.sshUser).toBe(sshUser)
        }
      })
    )
  })

  it("rejects generated non-empty unsafe sshUser values as InvalidOption", () => {
    fc.assert(
      fc.property(invalidNonEmptySshUserArbitrary, (sshUser) => {
        const result = buildCreateCommand({
          repoUrl: "https://github.com/org/repo.git",
          sshUser
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
    )
  })

  it("covers sshUser regex boundary lengths and first-character constraints", () => {
    const validLength32 = `_${"a".repeat(31)}`
    const invalidLength33 = `_${"a".repeat(32)}`

    const accepted = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: validLength32
    })
    const empty = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: ""
    })
    const tooLong = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: invalidLength33
    })
    const invalidFirstChar = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      sshUser: "1dev"
    })

    expect(Either.isRight(accepted)).toBe(true)
    if (Either.isRight(accepted)) {
      expect(accepted.right.config.sshUser).toBe(validLength32)
    }
    expect(Either.isLeft(empty)).toBe(true)
    if (Either.isLeft(empty)) {
      expect(empty.left).toEqual({
        _tag: "MissingRequiredOption",
        option: "--ssh-user"
      })
    }
    for (const result of [tooLong, invalidFirstChar]) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("InvalidOption")
        expect(result.left.option).toBe("--ssh-user")
      }
    }
  })

  it("normalizes Windows-style trailing separators in secrets root", () => {
    const result = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      secretsRoot: "C:\\Users\\Dev\\.docker-git\\secrets\\\\"
    })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.config.envGlobalPath).toBe("C:\\Users\\Dev\\.docker-git\\secrets/global.env")
      expect(result.right.config.codexAuthPath).toBe("C:\\Users\\Dev\\.docker-git\\secrets/codex")
    }
  })

  it("preserves Unix root secrets root without double separators", () => {
    const result = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      secretsRoot: "/"
    })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.config.envGlobalPath).toBe("/global.env")
      expect(result.right.config.codexAuthPath).toBe("/codex")
    }
  })

  it("preserves Windows drive root secrets root without mixed separators", () => {
    const result = buildCreateCommand({
      repoUrl: "https://github.com/org/repo.git",
      secretsRoot: "C:\\"
    })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.config.envGlobalPath).toBe("C:\\global.env")
      expect(result.right.config.codexAuthPath).toBe("C:\\codex")
    }
  })
})
