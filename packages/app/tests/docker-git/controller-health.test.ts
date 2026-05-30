/* jscpd:ignore-start */
import { HttpClient, HttpClientResponse } from "@effect/platform"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  findReachableApiBaseUrlWithHttpClient,
  findReachableDirectHealthProbeWithHttpClient
} from "../../src/docker-git/controller-health.js"

const expectedRevision = "local-revision"

const mismatchRevisionArbitrary = fc
  .integer({ min: 1, max: 10_000 })
  .map((index) => `old-revision-${index}`)

const candidateUrl = (baseUrl: string, index: number): string => `${baseUrl}/candidate-${index}`

const toCandidateUrls = (baseUrl: string, revisions: ReadonlyArray<string>): ReadonlyArray<string> =>
  revisions.map((_, index) => candidateUrl(baseUrl, index))

const parseCandidateIndex = (pathname: string): number | null => {
  const match = /^\/candidate-(\d+)\/health$/u.exec(pathname)
  if (match === null) {
    return null
  }
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : null
}

const healthResponse = (revisions: ReadonlyArray<string>, pathname: string): Response => {
  const index = parseCandidateIndex(pathname)
  const revision = index === null ? undefined : revisions[index]
  if (revision === undefined) {
    return Response.json({ ok: false }, { status: 404 })
  }

  return Response.json({ ok: true, revision })
}

const makeHealthClient = (revisions: ReadonlyArray<string>): HttpClient.HttpClient =>
  HttpClient.make((request, url) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, healthResponse(revisions, url.pathname)))
  )

const withHealthClient = <A, E>(
  revisions: ReadonlyArray<string>,
  effect: (baseUrl: string) => Effect.Effect<A, E, HttpClient.HttpClient>
): Effect.Effect<A, E> =>
  effect("http://controller.test").pipe(Effect.provideService(HttpClient.HttpClient, makeHealthClient(revisions)))

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
                withHealthClient([...before, expectedRevision, ...after], (baseUrl) =>
                  Effect.gen(function*(_) {
                    const candidates = toCandidateUrls(baseUrl, [...before, expectedRevision, ...after])
                    const selected = yield* _(
                      findReachableApiBaseUrlWithHttpClient(candidates, expectedRevision)
                    )

                    expect(selected).toBe(candidateUrl(baseUrl, before.length))
                  }))
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
                withHealthClient(revisions, (baseUrl) =>
                  Effect.gen(function*(_) {
                    const candidates = toCandidateUrls(baseUrl, revisions)
                    const error = yield* _(
                      findReachableApiBaseUrlWithHttpClient(candidates, expectedRevision).pipe(Effect.flip)
                    )

                    expect(error.message).toContain(expectedRevision)
                    for (const [index, revision] of revisions.entries()) {
                      expect(error.message).toContain(candidateUrl(baseUrl, index))
                      expect(error.message).toContain(revision)
                    }
                  }))
              )
          ),
          { numRuns: 20 }
        )
    }))

  it.effect("filters direct health probes by expected revision before bootstrap", () =>
    withHealthClient(["old-revision", expectedRevision], (baseUrl) =>
      Effect.gen(function*(_) {
        const probe = yield* _(
          findReachableDirectHealthProbeWithHttpClient({
            cachedApiBaseUrl: candidateUrl(baseUrl, 1),
            defaultLocalApiBaseUrl: candidateUrl(baseUrl, 0),
            explicitApiBaseUrl: undefined,
            expectedRevision
          })
        )

        expect(probe?.apiBaseUrl).toBe(candidateUrl(baseUrl, 1))
        expect(probe?.revision).toBe(expectedRevision)
      })))
})
/* jscpd:ignore-end */
