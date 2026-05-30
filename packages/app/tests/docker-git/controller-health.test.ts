import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import {
  findReachableApiBaseUrlMatchingRevision,
  findReachableDirectHealthProbe
} from "../../src/docker-git/controller-health.js"

const expectedRevision = "local-revision"

type HealthServer = {
  readonly baseUrl: string
  readonly server: Server
}

const mismatchRevisionArbitrary = fc
  .integer({ min: 1, max: 10_000 })
  .map((index) => `old-revision-${index}`)

const candidateUrl = (baseUrl: string, index: number): string => `${baseUrl}/candidate-${index}`

const parseCandidateIndex = (request: IncomingMessage): number | null => {
  const match = /^\/candidate-(\d+)\/health$/u.exec(request.url ?? "")
  if (match === null) {
    return null
  }
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : null
}

const handleHealthRequest = (revisions: ReadonlyArray<string>) => (
  request: IncomingMessage,
  response: ServerResponse
) => {
  const index = parseCandidateIndex(request)
  const revision = index === null ? undefined : revisions[index]
  if (revision === undefined) {
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ ok: false }))
    return
  }

  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify({ ok: true, revision }))
}

const listenHealthServer = (revisions: ReadonlyArray<string>): Effect.Effect<HealthServer, Error> =>
  Effect.async((resume) => {
    const server = createServer(handleHealthRequest(revisions))
    server.once("error", (error) => {
      resume(Effect.fail(error))
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address === "object" && address !== null) {
        resume(Effect.succeed({
          baseUrl: `http://127.0.0.1:${address.port}`,
          server
        }))
        return
      }
      resume(Effect.fail(new Error("Health test server did not expose a TCP port.")))
    })
  })

const closeHealthServer = (server: Server): Effect.Effect<void> =>
  Effect.async((resume) => {
    server.close(() => {
      resume(Effect.void)
    })
  })

const withHealthServer = <A, E, R>(
  revisions: ReadonlyArray<string>,
  effect: (baseUrl: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | Error, R> =>
  Effect.acquireUseRelease(
    listenHealthServer(revisions),
    ({ baseUrl }) => effect(baseUrl),
    ({ server }) => closeHealthServer(server)
  )

describe("controller health", () => {
  it.effect("selects the first reachable candidate whose revision matches the expected revision", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.array(mismatchRevisionArbitrary, { maxLength: 4 }),
            fc.array(mismatchRevisionArbitrary, { maxLength: 4 }),
            (before, after) =>
              Effect.runPromise(
                withHealthServer([...before, expectedRevision, ...after], (baseUrl) =>
                  Effect.gen(function*(_) {
                    const candidates = [...before, expectedRevision, ...after].map((_, index) =>
                      candidateUrl(baseUrl, index)
                    )
                    const selected = yield* _(
                      findReachableApiBaseUrlMatchingRevision(candidates, expectedRevision)
                    )

                    expect(selected).toBe(candidateUrl(baseUrl, before.length))
                  })
                )
              )
          ),
          { numRuns: 20 }
        )
    }))

  it.effect("reports every reachable mismatched revision when no candidate matches", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(
            fc.array(mismatchRevisionArbitrary, { minLength: 1, maxLength: 5 }),
            (revisions) =>
              Effect.runPromise(
                withHealthServer(revisions, (baseUrl) =>
                  Effect.gen(function*(_) {
                    const candidates = revisions.map((_, index) => candidateUrl(baseUrl, index))
                    const error = yield* _(
                      findReachableApiBaseUrlMatchingRevision(candidates, expectedRevision).pipe(Effect.flip)
                    )

                    expect(error.message).toContain(expectedRevision)
                    for (const [index, revision] of revisions.entries()) {
                      expect(error.message).toContain(candidateUrl(baseUrl, index))
                      expect(error.message).toContain(revision)
                    }
                  })
                )
              )
          ),
          { numRuns: 20 }
        )
    }))

  it.effect("filters direct health probes by expected revision before bootstrap", () =>
    withHealthServer(["old-revision", expectedRevision], (baseUrl) =>
      Effect.gen(function*(_) {
        const probe = yield* _(
          findReachableDirectHealthProbe({
            cachedApiBaseUrl: candidateUrl(baseUrl, 1),
            defaultLocalApiBaseUrl: candidateUrl(baseUrl, 0),
            explicitApiBaseUrl: undefined,
            expectedRevision
          })
        )

        expect(probe?.apiBaseUrl).toBe(candidateUrl(baseUrl, 1))
        expect(probe?.revision).toBe(expectedRevision)
      })
    ))
})
