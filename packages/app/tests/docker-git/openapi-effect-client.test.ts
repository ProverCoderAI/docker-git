import { describe, expect, it } from "@effect/vitest"
import { createClient } from "@prover-coder-ai/docker-git-openapi"
import type { ApiFailure } from "@prover-coder-ai/docker-git-openapi"
import { Effect } from "effect"
import * as fc from "fast-check"
import { afterEach, vi } from "vitest"

import type { JsonValue } from "../../src/shared/json-schema.js"
import { renderDockerGitOpenApiFailure } from "../../src/web/api-http.js"

type CapturedRequest = {
  readonly headers: Headers
  readonly method: string
  readonly url: string
}

type ApiErrorEnvelope = {
  readonly error: {
    readonly details?: string
    readonly message: string
    readonly type: string
  }
}

type InternalErrorResponses = {
  readonly 500: {
    readonly content: {
      readonly "application/json": ApiErrorEnvelope
    }
  }
}

const createJsonResponse = (status: number, value: JsonValue): Response =>
  Response.json(value, {
    headers: {
      "content-type": "application/json"
    },
    status
  })

const nullableErrorDetailsArbitrary = fc.option(fc.string(), { nil: null })

const errorMessageArbitrary = fc.string({ minLength: 1 })

const baseUrlOriginArbitrary = fc.webUrl().map((url) => new URL(url).origin)

const createMockFetch = (
  requests: Array<CapturedRequest>,
  response: Response
): (request: Request) => ReturnType<typeof fetch> =>
(request) => {
  requests.push({
    headers: request.headers,
    method: request.method,
    url: request.url
  })
  return Effect.runPromise(Effect.succeed(response))
}

/**
 * Runs a fast-check synchronous property inside the Effect test runtime.
 *
 * @param property - Finite pure property over OpenAPI boundary values.
 * @returns Effect that fails when fast-check finds a counterexample.
 *
 * @pure false - executes property samples.
 * @effect Effect.sync, fc.assert.
 * @invariant success proves every sampled case preserved the asserted pure invariant.
 * @precondition property predicate is synchronous and total.
 * @postcondition counterexamples are surfaced through the Effect error channel.
 * @complexity O(r * c) where r is numRuns and c is one predicate cost.
 * @throws Never.
 */
const assertOpenApiClientSyncProperty = <PropertyArgs>(property: fc.IProperty<PropertyArgs>) =>
  Effect.sync(() => {
    fc.assert(property, { numRuns: 25 })
  })

/**
 * Runs a fast-check async property inside the Effect test runtime.
 *
 * @param property - Finite property whose cases execute Effect-backed OpenAPI requests.
 * @returns Effect that fails when fast-check finds a counterexample.
 *
 * @pure false - executes property samples.
 * @effect Effect.tryPromise, fc.assert.
 * @invariant success proves every sampled case preserved the asserted client invariant.
 * @precondition property cases do not share mutable request capture arrays.
 * @postcondition counterexamples are surfaced through the Effect error channel.
 * @complexity O(r * c) where r is numRuns and c is one request case cost.
 * @throws Never.
 */
const assertOpenApiClientProperty = <PropertyArgs>(property: fc.IAsyncProperty<PropertyArgs>) =>
  Effect.tryPromise({
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    try: () => fc.assert(property, { numRuns: 25 })
  })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("docker-git OpenAPI Effect client", () => {
  it.effect("executes typed GET requests directly through openapi-effect", () =>
    Effect.gen(function*(_) {
      const requests: Array<CapturedRequest> = []
      const api = createClient({
        baseUrl: "https://docker-git.example.test",
        fetch: createMockFetch(
          requests,
          createJsonResponse(200, {
            cwd: "/workspace",
            ok: true,
            projectsRoot: "/workspace/projects",
            revision: null
          })
        )
      })

      const success = yield* _(api.GET("/health"))

      expect(success.status).toBe(200)
      expect(success.body).toEqual({
        cwd: "/workspace",
        ok: true,
        projectsRoot: "/workspace/projects",
        revision: null
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe("GET")
      expect(requests[0]?.headers.get("accept")).toBe("application/json")
      expect(requests[0]?.headers.get("cache-control")).toContain("no-cache")
      expect(new URL(requests[0]?.url ?? "").searchParams.has("_")).toBe(true)
    }))

  it.effect("property: nested API error envelopes preserve their message through UI rendering", () =>
    assertOpenApiClientSyncProperty(
      fc.property(nullableErrorDetailsArbitrary, errorMessageArbitrary, (details, message) => {
        const body: ApiErrorEnvelope = {
          error: {
            ...(details !== null && { details }),
            message,
            type: "Internal"
          }
        }
        const failure: ApiFailure<InternalErrorResponses> = {
          _tag: "HttpError",
          body,
          contentType: "application/json",
          status: 500
        }
        return renderDockerGitOpenApiFailure(failure).includes(JSON.stringify(message))
      })
    ))

  it.effect("property: GET requests always include no-cache transport invariants", () =>
    assertOpenApiClientProperty(
      fc.asyncProperty(
        baseUrlOriginArbitrary,
        (baseUrl) =>
          Effect.runPromise(
            Effect.gen(function*(_) {
              const requests: Array<CapturedRequest> = []
              const api = createClient({
                baseUrl,
                fetch: createMockFetch(
                  requests,
                  createJsonResponse(200, {
                    cwd: "/workspace",
                    ok: true,
                    projectsRoot: "/workspace/projects",
                    revision: null
                  })
                )
              })

              const result = yield* _(Effect.either(api.GET("/health")))

              expect(result._tag).toBe("Right")
              expect(requests).toHaveLength(1)
              expect(requests[0]?.method).toBe("GET")
              expect(requests[0]?.headers.get("accept")).toBe("application/json")
              expect(requests[0]?.headers.get("cache-control")).toContain("no-cache")
              expect(new URL(requests[0]?.url ?? "").origin).toBe(baseUrl)
              expect(new URL(requests[0]?.url ?? "").searchParams.has("_")).toBe(true)
            })
          )
      )
    ))

  it.effect("renders nested API error envelopes from direct openapi-effect failures", () =>
    Effect.gen(function*(_) {
      const api = createClient({
        baseUrl: "https://docker-git.example.test",
        fetch: createMockFetch(
          [],
          createJsonResponse(500, {
            error: {
              message: "container snapshot failed",
              type: "Internal"
            }
          })
        )
      })

      const healthResult = api.GET("/health").pipe(Effect.mapError(renderDockerGitOpenApiFailure))
      const result = yield* _(Effect.either(healthResult))

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toContain("container snapshot failed")
      }
    }))

  it.effect("treats 200 ok command responses as successful direct client effects", () =>
    Effect.gen(function*(_) {
      const requests: Array<CapturedRequest> = []
      const api = createClient({
        baseUrl: "https://docker-git.example.test",
        fetch: createMockFetch(requests, createJsonResponse(200, { ok: true }))
      })

      const success = yield* _(api.POST("/projects/down-all"))

      expect(success.status).toBe(200)
      expect(success.body).toEqual({ ok: true })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe("POST")
      expect(new URL(requests[0]?.url ?? "").pathname).toBe("/projects/down-all")
    }))

  it.effect("falls back to getRandomValues when randomUUID is unavailable", () =>
    Effect.gen(function*(_) {
      const requests: Array<CapturedRequest> = []
      const capturedIds: Array<string> = []
      vi.stubGlobal("crypto", {
        getRandomValues: (values: Uint8Array): Uint8Array => {
          values.set([0x10, 0x32, 0x54, 0x76, 0x98])
          return values
        }
      })

      const api = createClient({
        baseUrl: "https://docker-git.example.test",
        fetch: createMockFetch(
          requests,
          createJsonResponse(200, {
            cwd: "/workspace",
            ok: true,
            projectsRoot: "/workspace/projects",
            revision: null
          })
        )
      })
      api.use({
        onRequest: ({ id }) => {
          capturedIds.push(id)
        }
      })

      const success = yield* _(api.GET("/health"))

      expect(success.status).toBe(200)
      expect(capturedIds).toEqual(["103254769"])
      expect(requests).toHaveLength(1)
    }))

  it.effect("falls back to a clock-based request id when Web Crypto is missing", () =>
    Effect.gen(function*(_) {
      const capturedIds: Array<string> = []
      vi.stubGlobal("crypto", undefined)
      vi.spyOn(Date, "now").mockReturnValue(0x1234567)

      const api = createClient({
        baseUrl: "https://docker-git.example.test",
        fetch: createMockFetch(
          [],
          createJsonResponse(200, {
            cwd: "/workspace",
            ok: true,
            projectsRoot: "/workspace/projects",
            revision: null
          })
        )
      })
      api.use({
        onRequest: ({ id }) => {
          capturedIds.push(id)
        }
      })

      const success = yield* _(api.GET("/health"))

      expect(success.status).toBe(200)
      expect(capturedIds).toEqual(["123456700"])
    }))
})
