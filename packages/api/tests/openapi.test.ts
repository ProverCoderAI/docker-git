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

  it.effect("documents real HTTP success status codes for create and async endpoints", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const paths = spec.paths ?? {}

      const postResponseStatuses = (path: string): ReadonlyArray<string> =>
        Object.keys(paths[path]?.post?.responses ?? {})

      expect(postResponseStatuses("/projects")).toEqual(expect.arrayContaining(["201", "202", "400"]))
      expect(postResponseStatuses("/projects/{projectId}/ports")).toEqual(expect.arrayContaining(["201", "400"]))
      expect(postResponseStatuses("/projects/{projectId}/databases/profiles")).toEqual(
        expect.arrayContaining(["201", "400"])
      )
      expect(postResponseStatuses("/projects/{projectId}/databases/profiles/{profileId}/expose")).toEqual(
        expect.arrayContaining(["201", "400"])
      )
      expect(postResponseStatuses("/auth/terminal-sessions")).toEqual(expect.arrayContaining(["201", "400"]))
      expect(postResponseStatuses("/projects/by-key/{projectKey}/terminal-sessions")).toEqual(
        expect.arrayContaining(["201", "400"])
      )
      expect(postResponseStatuses("/projects/by-key/{projectKey}/terminal-sessions/start")).toEqual(
        expect.arrayContaining(["202", "400"])
      )
    }))

  it.effect("documents the nested API error envelope used by HTTP handlers", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const serializedBadRequestSchema = JSON.stringify(
        spec.paths?.["/projects"]?.post?.responses?.["400"] ?? {}
      )

      expect(serializedBadRequestSchema).toContain("\"required\":[\"error\"]")
      expect(serializedBadRequestSchema).toContain("\"error\":{\"type\":\"object\"")
      expect(serializedBadRequestSchema).toContain("\"type\":{\"type\":\"string\"")
      expect(serializedBadRequestSchema).toContain("\"message\":{\"type\":\"string\"")
      expect(serializedBadRequestSchema).toContain("\"provider\":{\"type\":\"string\"")
      expect(serializedBadRequestSchema).toContain("\"command\":{\"type\":\"string\"")
      expect(serializedBadRequestSchema).not.toContain("\"required\":[\"error\",\"message\"]")
    }))
})
