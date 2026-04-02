import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { request } from "../../src/docker-git/api-http.js"

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const ensureControllerReadyMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock,
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")
const toFetchUrl = (value: Parameters<typeof globalThis.fetch>[0] | undefined): string => {
  if (value === undefined) {
    throw new TypeError("unexpected undefined fetch request value")
  }
  if (typeof value === "string") {
    return value
  }
  if (value instanceof URL) {
    return value.toString()
  }
  if (value instanceof Request) {
    return value.url
  }

  throw new TypeError("unexpected fetch request value")
}

describe("api-http request retry", () => {
  beforeEach(() => {
    resolveApiBaseUrlMock.mockReset()
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("refreshes controller readiness once after a transport failure", () =>
    Effect.gen(function*(_) {
      const fetchMock = vi.fn<typeof globalThis.fetch>()
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
      fetchMock.mockResolvedValueOnce(
        Response.json({ ok: true }, {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      vi.stubGlobal("fetch", fetchMock)

      resolveApiBaseUrlMock.mockReturnValueOnce(
        makeHttpUrl(joinIp("127", "0", "0", "1"), "3334")
      )
      resolveApiBaseUrlMock.mockReturnValueOnce(
        makeHttpUrl(joinIp("172", "17", "0", "20"), "3334")
      )

      const payload = yield* _(request("GET", "/health"))

      expect(payload).toEqual({ ok: true })
      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const firstCall = fetchMock.mock.calls[0]?.[0]
      const secondCall = fetchMock.mock.calls[1]?.[0]
      expect(toFetchUrl(firstCall)).toContain(`${joinIp("127", "0", "0", "1")}:3334/health`)
      expect(toFetchUrl(secondCall)).toContain(`${joinIp("172", "17", "0", "20")}:3334/health`)
    }).pipe(Effect.provide(NodeContext.layer)))
})
