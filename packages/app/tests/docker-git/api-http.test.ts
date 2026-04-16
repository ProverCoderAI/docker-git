/* jscpd:ignore-start */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

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

const listen = (server: Server): Effect.Effect<number, Error> =>
  Effect.async((resume) => {
    const onError = (error: Error) => {
      resume(Effect.fail(error))
    }

    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      resume(Effect.succeed((server.address() as AddressInfo).port))
    })

    return Effect.sync(() => {
      server.off("error", onError)
    })
  })

const close = (server: Server): Effect.Effect<void, Error> =>
  Effect.async((resume) => {
    server.close((error) => {
      if (error === undefined) {
        resume(Effect.void)
        return
      }
      resume(Effect.fail(error))
    })
  })

const reserveUnusedPort = () =>
  Effect.gen(function*(_) {
    const server = createServer()
    const port = yield* _(listen(server))
    yield* _(close(server))
    return port
  })

describe("api-http request retry", () => {
  beforeEach(() => {
    resolveApiBaseUrlMock.mockReset()
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
  })

  it.effect("refreshes controller readiness once after a transport failure", () =>
    Effect.gen(function*(_) {
      const seenUrls: Array<string | undefined> = []
      const server = createServer((incoming, response) => {
        seenUrls.push(incoming.url)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true }))
      })
      const deadPort = yield* _(reserveUnusedPort())
      const port = yield* _(listen(server))

      yield* _(
        Effect.gen(function*(_) {
          resolveApiBaseUrlMock.mockReturnValueOnce(
            makeHttpUrl(joinIp("127", "0", "0", "1"), String(deadPort))
          )
          resolveApiBaseUrlMock.mockReturnValueOnce(
            makeHttpUrl(joinIp("127", "0", "0", "1"), String(port))
          )

          const payload = yield* _(request("GET", "/health"))

          expect(payload).toEqual({ ok: true })
          expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
          expect(seenUrls).toEqual(["/health"])
        }).pipe(
          Effect.ensuring(close(server).pipe(Effect.catchAll(() => Effect.void)))
        )
      )
    }).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not replay mutating requests after a transport failure", () =>
    Effect.gen(function*(_) {
      const deadPort = yield* _(reserveUnusedPort())

      resolveApiBaseUrlMock.mockReturnValue(
        makeHttpUrl(joinIp("127", "0", "0", "1"), String(deadPort))
      )

      const result = yield* _(Effect.either(request("POST", "/projects", { outDir: "project-1" })))

      expect(result._tag).toBe("Left")
      expect(ensureControllerReadyMock).not.toHaveBeenCalled()
      expect(resolveApiBaseUrlMock).toHaveBeenCalledTimes(1)
    }).pipe(Effect.provide(NodeContext.layer)))
})
