import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"

import { deriveScrapWorkspaceRelativePath } from "../../src/usecases/scrap.js"

describe("deriveScrapWorkspaceRelativePath", () => {
  it("derives a home-relative path for a nested workspace", () => {
    const result = deriveScrapWorkspaceRelativePath("dev", "/home/dev/org/repo")

    Either.match(result, {
      onLeft: (error) => {
        throw new Error(`unexpected error ${error._tag}`)
      },
      onRight: (value) => {
        expect(value).toBe("org/repo")
      }
    })
  })

  it("returns empty relative path for the home root", () => {
    const result = deriveScrapWorkspaceRelativePath("dev", "/home/dev")

    Either.match(result, {
      onLeft: (error) => {
        throw new Error(`unexpected error ${error._tag}`)
      },
      onRight: (value) => {
        expect(value).toBe("")
      }
    })
  })

  it("supports workspace path written with ~", () => {
    const result = deriveScrapWorkspaceRelativePath("dev", "~/org/repo")

    Either.match(result, {
      onLeft: (error) => {
        throw new Error(`unexpected error ${error._tag}`)
      },
      onRight: (value) => {
        expect(value).toBe("org/repo")
      }
    })
  })

  it("fails when targetDir is outside the user's home", () => {
    const result = deriveScrapWorkspaceRelativePath("dev", "/opt/app")

    Either.match(result, {
      onLeft: (error) => {
        expect(error._tag).toBe("ScrapTargetDirUnsupportedError")
        expect(error.reason).toContain("/home/dev")
      },
      onRight: () => {
        throw new Error("expected error")
      }
    })
  })

  it("fails when targetDir includes parent traversal segments", () => {
    const result = deriveScrapWorkspaceRelativePath("dev", "/home/dev/org/../repo")

    Either.match(result, {
      onLeft: (error) => {
        expect(error._tag).toBe("ScrapTargetDirUnsupportedError")
        expect(error.reason).toContain("..")
      },
      onRight: () => {
        throw new Error("expected error")
      }
    })
  })
})
