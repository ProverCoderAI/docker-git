import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { request } from "../../src/docker-git/api-http.js"

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const ensureControllerReadyMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())

vi.mock("../../src/docker-git/controller.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/docker-git/controller.js")>(
    "../../src/docker-git/controller.js"
  )

  return {
    ...actual,
    ensureControllerReady: ensureControllerReadyMock,
    resolveApiBaseUrl: resolveApiBaseUrlMock
  }
})

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

      resolveApiBaseUrlMock.mockReturnValueOnce("http://127.0.0.1:3334")
      resolveApiBaseUrlMock.mockReturnValueOnce("http://172.17.0.20:3334")

      const payload = yield* _(request("GET", "/health"))

      expect(payload).toEqual({ ok: true })
      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:3334/health")
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://172.17.0.20:3334/health")
    }).pipe(Effect.provide(NodeContext.layer)))
})
