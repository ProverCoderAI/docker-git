import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { buildDockerGitOpenApi } from "../src/api/openapi.js"

describe("openapi contract", () => {
  it.effect("documents generated REST paths from the Effect HttpApi contract", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const paths = spec.paths ?? {}

      expect(spec.openapi).toBe("3.1.0")
      expect(paths["/health"]).toBeDefined()
      expect(paths["/projects"]).toBeDefined()
      expect(paths["/projects/{projectId}"]).toBeDefined()
      expect(paths["/auth/git/status"]).toBeDefined()
      expect(paths["/auth/gitlab/status"]).toBeDefined()
      expect(paths["/auth/codex/status"]).toBeDefined()
      expect(paths["/auth/grok/status"]).toBeDefined()
      expect(paths["/auth/codex/login"]).toBeUndefined()
      expect(paths["/projects/{projectId}/auth/menu"]).toBeDefined()
      expect(paths["/projects/{projectId}/auth"]).toBeUndefined()
      expect(Object.keys(paths)).toHaveLength(54)
    }))
})
