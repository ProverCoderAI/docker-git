import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { deleteTerminalSessionByPath } from "../../src/web/api-terminal.js"

type CapturedDeleteRequest = {
  readonly params: Readonly<Record<string, string>>
  readonly route: string
}

type MinimalDeleteClient = {
  readonly DELETE: (
    route: string,
    options: { readonly params: { readonly path: Readonly<Record<string, string>> } }
  ) => void
}

const capturedDeleteRequests = vi.hoisted((): Array<CapturedDeleteRequest> => [])
const openApiVoidMock = vi.hoisted(() =>
  vi.fn((request: (client: MinimalDeleteClient) => void) => {
    const client: MinimalDeleteClient = {
      DELETE: (route, options) => {
        capturedDeleteRequests.push({
          params: options.params.path,
          route
        })
      }
    }
    request(client)
    return Effect.void
  })
)

vi.mock("../../src/web/api-http.js", () => ({
  dockerGitOpenApi: {
    openApiJsonSchema: vi.fn(),
    openApiVoid: openApiVoidMock
  }
}))

describe("api terminal helpers", () => {
  beforeEach(() => {
    capturedDeleteRequests.length = 0
    openApiVoidMock.mockClear()
  })

  it.effect("routes auth terminal close paths through the typed OpenAPI endpoint", () =>
    deleteTerminalSessionByPath("/auth/terminal-sessions/auth-session-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(capturedDeleteRequests).toEqual([
            {
              params: { sessionId: "auth-session-1" },
              route: "/auth/terminal-sessions/{sessionId}"
            }
          ])
        })
      )
    ))

  it.effect("routes project terminal close paths through the typed OpenAPI endpoint", () =>
    deleteTerminalSessionByPath("/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(capturedDeleteRequests).toEqual([
            {
              params: {
                projectKey: "octocat/hello-world",
                sessionId: "session-1"
              },
              route: "/projects/by-key/{projectKey}/terminal-sessions/{sessionId}"
            }
          ])
        })
      )
    ))

  it.effect("rejects unsupported terminal close paths before issuing a request", () =>
    Effect.gen(function*(_) {
      const result = yield* _(Effect.either(deleteTerminalSessionByPath("/terminal-sessions/session-1")))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBe("Invalid terminal close path: /terminal-sessions/session-1")
      }
      expect(capturedDeleteRequests).toEqual([])
    }))
})
