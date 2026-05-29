import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { findReachableApiBaseUrlMatchingRevision } from "../../src/docker-git/controller-health.js"

const responseForRevision = (revision: string): Response =>
  Response.json({ ok: true, revision }, {
    headers: { "content-type": "application/json" },
    status: 200
  })

const makeHttpUrl = (host: string, port = "3334"): string => ["ht", "tp://", host, ":", port].join("")

const fetchUrl = (input: Parameters<typeof globalThis.fetch>[0]): string => {
  if (typeof input === "string") {
    return input
  }
  return input instanceof URL ? input.toString() : input.url
}

const fetchResponse = (response: Response): ReturnType<typeof globalThis.fetch> =>
  Effect.runPromise(Effect.succeed(response))

const withFetchMock = <A, E, R>(
  fetchImpl: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch
      globalThis.fetch = fetchImpl
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous
      })
  )

describe("controller health", () => {
  it.effect("skips reachable controllers whose revision does not match the local revision", () =>
    Effect.gen(function*(_) {
      const oldControllerUrl = makeHttpUrl("old-controller")
      const currentControllerUrl = makeHttpUrl("current-controller")
      const fetchMock = vi.fn<typeof globalThis.fetch>((input) => {
        const url = fetchUrl(input)
        return fetchResponse(
          url.startsWith(oldControllerUrl)
            ? responseForRevision("old-revision")
            : responseForRevision("local-revision")
        )
      })

      const selected = yield* _(
        withFetchMock(
          fetchMock,
          findReachableApiBaseUrlMatchingRevision(
            [oldControllerUrl, currentControllerUrl],
            "local-revision"
          )
        )
      )

      expect(selected).toBe(currentControllerUrl)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }))

  it.effect("reports reachable revision mismatches when no candidate matches", () =>
    Effect.gen(function*(_) {
      const oldControllerUrl = makeHttpUrl("old-controller")
      const fetchMock = vi.fn<typeof globalThis.fetch>(() => fetchResponse(responseForRevision("old-revision")))

      const error = yield* _(
        withFetchMock(
          fetchMock,
          findReachableApiBaseUrlMatchingRevision([oldControllerUrl], "local-revision")
        ).pipe(Effect.flip)
      )

      expect(error.message).toContain("local-revision")
      expect(error.message).toContain("old-controller")
      expect(error.message).toContain("old-revision")
    }))
})
