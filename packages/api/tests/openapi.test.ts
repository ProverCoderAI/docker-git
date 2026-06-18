import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { buildDockerGitOpenApi } from "../src/api/openapi.js"

const documentedMethods = ["delete", "get", "post", "put"] as const
const commonErrorStatuses = ["400", "401", "404", "409", "500"]

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

  it.effect("documents common API error statuses for every JSON REST operation", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const paths = spec.paths ?? {}

      for (const [path, item] of Object.entries(paths)) {
        for (const method of documentedMethods) {
          const responses = item[method]?.responses
          if (responses === undefined) {
            continue
          }

          expect(Object.keys(responses), `${method.toUpperCase()} ${path}`).toEqual(
            expect.arrayContaining(commonErrorStatuses)
          )
        }
      }
    }))

  it.effect("documents ok-only HTTP handlers as 200 JSON responses", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const paths = spec.paths ?? {}
      const okOnlyOperations = [
        { method: "post", path: "/projects/apply-all" },
        { method: "post", path: "/projects/down-all" },
        { method: "delete", path: "/projects/{projectId}" },
        { method: "post", path: "/projects/{projectId}/down" },
        { method: "delete", path: "/projects/{projectId}/ports/{targetPort}" },
        { method: "delete", path: "/projects/{projectId}/databases/profiles/{profileId}" },
        { method: "delete", path: "/projects/{projectId}/databases/profiles/{profileId}/expose" },
        { method: "delete", path: "/projects/by-key/{projectKey}/terminal-sessions/{sessionId}" },
        { method: "delete", path: "/auth/terminal-sessions/{sessionId}" },
        { method: "post", path: "/projects/{projectId}/tasks/{pid}/stop" }
      ] as const

      for (const operation of okOnlyOperations) {
        const responses = paths[operation.path]?.[operation.method]?.responses ?? {}
        const serializedSuccessSchema = JSON.stringify(responses["200"] ?? {})

        expect(responses["200"], `${operation.method.toUpperCase()} ${operation.path}`).toBeDefined()
        expect(responses["204"], `${operation.method.toUpperCase()} ${operation.path}`).toBeUndefined()
        expect(serializedSuccessSchema).toContain("\"required\":[\"ok\"]")
        expect(serializedSuccessSchema).toContain("\"ok\":{\"type\":\"boolean\",\"enum\":[true]}")
      }
    }))

  it.effect("documents project auth snapshots without nonexistent totalEntries", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const serializedProjectAuthSchema = JSON.stringify(
        spec.paths?.["/projects/{projectId}/auth/menu"]?.get?.responses?.["200"] ?? {}
      )

      expect(serializedProjectAuthSchema).toContain("\"projectName\":{\"type\":\"string\"")
      expect(serializedProjectAuthSchema).not.toContain("\"totalEntries\"")
    }))

  it.effect("documents active terminal response ok envelope", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const serializedActiveTerminalSchema = JSON.stringify(
        spec.paths?.["/projects/by-key/{projectKey}/terminal-sessions/active"]?.put?.responses?.["200"] ?? {}
      )

      expect(serializedActiveTerminalSchema).toContain("\"required\":[\"session\"]")
      expect(serializedActiveTerminalSchema).toContain("\"ok\":{\"type\":\"boolean\"")
      expect(serializedActiveTerminalSchema).toContain("\"session\":{\"type\":\"object\"")
    }))

  it.effect("documents task snapshot terminal sessions and agents", () =>
    Effect.sync(() => {
      const spec = buildDockerGitOpenApi()
      const serializedTaskSchema = JSON.stringify(
        spec.paths?.["/projects/{projectId}/tasks"]?.get?.responses?.["200"] ?? {}
      )

      expect(serializedTaskSchema).toContain("\"required\":[\"agents\"")
      expect(serializedTaskSchema).toContain("\"terminalSessions\"")
      expect(serializedTaskSchema).toContain("\"provider\":{\"type\":\"string\"")
      expect(serializedTaskSchema).toContain("\"sshCommand\":{\"type\":\"string\"")
    }))
})
