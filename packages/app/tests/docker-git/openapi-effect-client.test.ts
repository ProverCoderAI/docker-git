import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { describe, expect, it } from "@effect/vitest"
import { createClient } from "@prover-coder-ai/docker-git-openapi"
import type { ApiTransportValue } from "@prover-coder-ai/docker-git-openapi"
import { Effect, Either } from "effect"
import * as fc from "fast-check"

type CapturedRequest = {
  readonly headers: Headers
  readonly method: string
  readonly url: string
}

const HealthResponseSchema = Schema.Struct({
  cwd: Schema.String,
  ok: Schema.Boolean,
  projectsRoot: Schema.String,
  revision: Schema.NullOr(Schema.String)
})

const NullableStringTransportValue = fc.option(fc.string(), { nil: null })

const createJsonResponse = (status: number, value: ApiTransportValue): Response =>
  Response.json(value, {
    headers: {
      "content-type": "application/json"
    },
    status
  })

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
    catch: (cause) => cause,
    try: () => fc.assert(property, { numRuns: 25 })
  })

describe("docker-git OpenAPI Effect client", () => {
  it.effect("executes typed GET requests through openapi-effect and decodes JSON with Schema", () =>
    Effect.gen(function*(_) {
      const requests: Array<CapturedRequest> = []
      const api = createClient({
        fetch: createMockFetch(
          requests,
          createJsonResponse(200, {
            cwd: "/workspace",
            ok: true,
            projectsRoot: "/workspace/projects",
            revision: null
          })
        ),
        resolveBaseUrl: () => "https://docker-git.example.test"
      })

      const decoded = yield* _(api.openApiJsonSchema(HealthResponseSchema, (client) => client.GET("/health")))

      expect(decoded).toEqual({
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

  it.effect("property: schema decoding preserves JSON null transport values", () =>
    assertOpenApiClientSyncProperty(
      fc.property(NullableStringTransportValue, (value) =>
        Either.match(ParseResult.decodeUnknownEither(Schema.Null)(value), {
          onLeft: () =>
            value !== null,
          onRight: (decoded) => decoded === value
        }))
    ))

  it.effect("property: GET requests always include no-cache transport invariants", () =>
    assertOpenApiClientProperty(
      fc.asyncProperty(
        fc.webUrl().map((url) => new URL(url).origin),
        (baseUrl) =>
          Effect.runPromise(
            Effect.gen(function*(_) {
              const requests: Array<CapturedRequest> = []
              const api = createClient({
                fetch: createMockFetch(
                  requests,
                  createJsonResponse(200, {
                    cwd: "/workspace",
                    ok: true,
                    projectsRoot: "/workspace/projects",
                    revision: null
                  })
                ),
                resolveBaseUrl: () => baseUrl
              })

              const result = yield* _(
                Effect.either(api.openApiJsonSchema(HealthResponseSchema, (client) => client.GET("/health")))
              )

              expect(result._tag).toBe("Right")
              expect(requests).toHaveLength(1)
              expect(requests[0]?.method).toBe("GET")
              expect(requests[0]?.headers.get("accept")).toBe("application/json")
              expect(requests[0]?.headers.get("cache-control")).toContain("no-cache")
              expect(new URL(requests[0]?.url ?? "").searchParams.has("_")).toBe(true)
            })
          )
      )
    ))

  it.effect("renders nested API error envelopes from openapi-effect failures", () =>
    Effect.gen(function*(_) {
      const api = createClient({
        fetch: createMockFetch(
          [],
          createJsonResponse(500, {
            error: {
              message: "container snapshot failed",
              type: "Internal"
            }
          })
        ),
        resolveBaseUrl: () => "https://docker-git.example.test"
      })

      const result = yield* _(
        Effect.either(api.openApiJsonSchema(HealthResponseSchema, (client) => client.GET("/health")))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toContain("container snapshot failed")
      }
    }))

  it.effect("preserves JSON null as a valid schema-decoded transport value", () =>
    Effect.gen(function*(_) {
      const api = createClient({
        fetch: createMockFetch([], createJsonResponse(200, null)),
        resolveBaseUrl: () => "https://docker-git.example.test"
      })

      const value = yield* _(api.openApiJsonSchema(Schema.Null, (client) => client.GET("/health")))

      expect(value).toBeNull()
    }))

  it.effect("treats 200 ok command responses as successful void effects", () =>
    Effect.gen(function*(_) {
      const requests: Array<CapturedRequest> = []
      const api = createClient({
        fetch: createMockFetch(requests, createJsonResponse(200, { ok: true })),
        resolveBaseUrl: () => "https://docker-git.example.test"
      })

      yield* _(api.openApiVoid((client) => client.POST("/projects/down-all")))

      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe("POST")
      expect(new URL(requests[0]?.url ?? "").pathname).toBe("/projects/down-all")
    }))
})
