import { describe, expect, it } from "@effect/vitest"
import { Either, Effect } from "effect"

import { deriveRepoSlug, parseMenuSelection } from "../../src/core/domain.js"

describe("deriveRepoSlug", () => {
  it.effect("handles https urls", () =>
    Effect.sync(() => {
      Either.match(Either.right(deriveRepoSlug("https://github.com/org/repo.git")), {
        onLeft: () => {
          throw new Error("unexpected left")
        },
        onRight: (slug) => {
          expect(slug).toBe("repo")
        }
      })
    }))

  it.effect("handles ssh urls", () =>
    Effect.sync(() => {
      Either.match(Either.right(deriveRepoSlug("git@github.com:org/awesome-repo.git")), {
        onLeft: () => {
          throw new Error("unexpected left")
        },
        onRight: (slug) => {
          expect(slug).toBe("awesome-repo")
        }
      })
    }))

  it.effect("falls back to app for empty", () =>
    Effect.sync(() => {
      Either.match(Either.right(deriveRepoSlug("")), {
        onLeft: () => {
          throw new Error("unexpected left")
        },
        onRight: (slug) => {
          expect(slug).toBe("app")
        }
      })
    }))
})

describe("parseMenuSelection", () => {
  it.effect("accepts create alias", () =>
    Effect.sync(() => {
      Either.match(parseMenuSelection("1"), {
        onLeft: () => {
          throw new Error("expected right")
        },
        onRight: (action) => {
          expect(action._tag).toBe("Create")
        }
      })
    }))

  it.effect("rejects empty", () =>
    Effect.sync(() => {
      Either.match(parseMenuSelection(""), {
        onLeft: (error) => {
          expect(error._tag).toBe("InvalidOption")
        },
        onRight: () => {
          throw new Error("expected left")
        }
      })
    }))
})
