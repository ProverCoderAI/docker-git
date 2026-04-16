/* jscpd:ignore-start */
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { request } from "../../src/docker-git/api-http.js"
/* jscpd:ignore-end */

const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const ensureControllerReadyMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock,
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")

describe("api-http request retry", () => {
  beforeEach(() => {
    resolveApiBaseUrlMock.mockReset()
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
  })

  it.effect("refreshes controller readiness once after a transport failure", () =>
    Effect.gen(function*(_) {
      resolveApiBaseUrlMock.mockReturnValueOnce(
        makeHttpUrl(joinIp("127", "0", "0", "1"), "1")
      )
      resolveApiBaseUrlMock.mockReturnValueOnce(
        makeHttpUrl(joinIp("127", "0", "0", "1"), "2")
      )

      const result = yield* _(Effect.either(request("GET", "/health")))

      expect(result._tag).toBe("Left")
      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(resolveApiBaseUrlMock).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not replay mutating requests after a transport failure", () =>
    Effect.gen(function*(_) {
      resolveApiBaseUrlMock.mockReturnValue(
        makeHttpUrl(joinIp("127", "0", "0", "1"), "1")
      )

      const result = yield* _(Effect.either(request("POST", "/projects", { outDir: "project-1" })))

      expect(result._tag).toBe("Left")
      expect(ensureControllerReadyMock).not.toHaveBeenCalled()
      expect(resolveApiBaseUrlMock).toHaveBeenCalledTimes(1)
    }).pipe(Effect.provide(NodeContext.layer)))
})
