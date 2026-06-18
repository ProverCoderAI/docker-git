import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { makeRouter } from "../src/http.js"

const SKILLER_WEB_PRODUCTION_ORIGIN = "https://skiller-web-henna.vercel.app"

const apiHandler = HttpApp.toWebHandler(
  Effect.provide(Effect.flatten(HttpRouter.toHttpApp(makeRouter())), NodeContext.layer)
)

type ApiRequestInit = {
  readonly headers: Record<string, string>
  readonly method: string
}

const requestApiRoute = (path: string, init: ApiRequestInit) =>
  Effect.tryPromise({
    try: () => apiHandler(new Request(`http://127.0.0.1${path}`, init)),
    catch: (cause) => new Error(String(cause))
  })

const skillerPrivateNetworkPreflight = (path: string) =>
  requestApiRoute(path, {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-private-network": "true",
      origin: SKILLER_WEB_PRODUCTION_ORIGIN
    }
  })

const setOptionalEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

const withTemporaryEnv = <A, E, R>(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previousEntries: Array<readonly [string, string | undefined]> = []
      for (const [key, value] of entries) {
        previousEntries.push([key, process.env[key]])
        setOptionalEnv(key, value)
      }
      return previousEntries
    }),
    () => effect,
    (previousEntries) =>
      Effect.sync(() => {
        for (const [key, value] of previousEntries) {
          setOptionalEnv(key, value)
        }
      })
  )

const readStringProperty = (value: object, key: string): string | null => {
  const field = Reflect.get(value, key)
  return typeof field === "string" ? field : null
}

const readLaunchResponse = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => new Error(String(cause))
  }).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (cause) => new Error(String(cause))
      })
    ),
    Effect.flatMap((value) => {
      if (typeof value !== "object" || value === null) {
        return Effect.fail(new Error("Expected Skiller launch response object."))
      }
      const appPath = readStringProperty(value, "appPath")
      const backendUrl = readStringProperty(value, "backendUrl")
      return appPath === null || backendUrl === null
        ? Effect.fail(new Error("Expected Skiller launch appPath and backendUrl strings."))
        : Effect.succeed({ appPath, backendUrl })
    })
  )

const readTextResponse = (response: Response) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => new Error(String(cause))
  })

const requestExternalLaunch = (
  headers: Record<string, string>,
  env: ReadonlyArray<readonly [string, string | undefined]> = []
) =>
  withTemporaryEnv(
    [
      ["DOCKER_GIT_SKILLER_WEB_URL", SKILLER_WEB_PRODUCTION_ORIGIN],
      ...env
    ],
    Effect.gen(function*(_) {
      const response = yield* _(requestApiRoute("/skiller/open", {
        method: "POST",
        headers
      }))
      const body = yield* _(readLaunchResponse(response))
      return { body, response }
    })
  )

describe("skiller web CORS", () => {
  it("allows production Skiller Web private-network preflight requests", () =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const paths = [
          "/skiller/connect",
          "/api/skiller/connect",
          "/skiller/trpc/list_projects",
          "/skiller/events",
          "/projects/by-key/project-proof/skiller/context",
          "/projects/by-key/project-proof/terminal-sessions/session-proof/skiller/context"
        ] as const

        for (const path of paths) {
          const response = yield* _(skillerPrivateNetworkPreflight(path))

          expect(response.status).toBe(204)
          expect(response.headers.get("access-control-allow-origin")).toBe(SKILLER_WEB_PRODUCTION_ORIGIN)
          expect(response.headers.get("access-control-allow-private-network")).toBe("true")
          expect(response.headers.get("vary")).toContain("access-control-request-private-network")
        }
      })
    ))

  it("builds external launch URLs with the forwarded web proxy prefix", () =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const { body, response } = yield* _(requestExternalLaunch({
          "x-forwarded-host": "192.168.0.206:4174",
          "x-forwarded-prefix": "/api",
          "x-forwarded-proto": "https"
        }))
        const wrapperResponse = yield* _(requestApiRoute(body.appPath, {
          method: "GET",
          headers: {}
        }))
        const wrapperHtml = yield* _(readTextResponse(wrapperResponse))

        expect(response.status).toBe(202)
        expect(body.backendUrl).toBe("https://192.168.0.206:4174/api")
        expect(body.appPath).toMatch(/^\/api\/skiller\/external-launch\/[0-9a-f-]+$/u)
        expect(body.appPath).not.toContain("backendUrl")
        expect(wrapperResponse.status).toBe(200)
        expect(wrapperResponse.headers.get("content-type")).toContain("text/html")
        expect(wrapperHtml).toContain(`${SKILLER_WEB_PRODUCTION_ORIGIN}/launch?`)
        expect(wrapperHtml).toContain("backendUrl=https%3A%2F%2F192.168.0.206%3A4174%2Fapi")
      })
    ))

  it("normalizes safe forwarded prefixes and ignores unsafe ones for external launch URLs", () =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const baseHeaders = {
          "x-forwarded-host": "192.168.0.206:4174",
          "x-forwarded-proto": "https"
        }
        const trailing = yield* _(requestExternalLaunch({
          ...baseHeaders,
          "x-forwarded-prefix": "/api/"
        }))
        const root = yield* _(requestExternalLaunch({
          ...baseHeaders,
          "x-forwarded-prefix": "/"
        }))
        const invalid = yield* _(requestExternalLaunch({
          ...baseHeaders,
          "x-forwarded-prefix": "https://evil.example/api"
        }))

        expect(trailing.body.backendUrl).toBe("https://192.168.0.206:4174/api")
        expect(root.body.backendUrl).toBe("https://192.168.0.206:4174")
        expect(invalid.body.backendUrl).toBe("https://192.168.0.206:4174")
      })
    ))

  it("prefers explicit Skiller backend URL over forwarded request metadata", () =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const { body } = yield* _(requestExternalLaunch(
          {
            "x-forwarded-host": "192.168.0.206:4174",
            "x-forwarded-prefix": "/api",
            "x-forwarded-proto": "http"
          },
          [["DOCKER_GIT_SKILLER_BACKEND_URL", "https://skiller-backend.example/custom"]]
        ))
        const wrapperResponse = yield* _(requestApiRoute(body.appPath, {
          method: "GET",
          headers: {}
        }))
        const wrapperHtml = yield* _(readTextResponse(wrapperResponse))

        expect(body.backendUrl).toBe("https://skiller-backend.example/custom")
        expect(body.appPath).toMatch(/^\/api\/skiller\/external-launch\/[0-9a-f-]+$/u)
        expect(body.appPath).not.toContain("skiller-backend.example")
        expect(wrapperResponse.status).toBe(200)
        expect(wrapperHtml).toContain("backendUrl=https%3A%2F%2Fskiller-backend.example%2Fcustom")
      })
    ))

  it("rejects private-network preflight requests from unknown origins", () =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const response = yield* _(requestApiRoute("/skiller/connect", {
          method: "OPTIONS",
          headers: {
            "access-control-request-method": "POST",
            "access-control-request-private-network": "true",
            origin: "https://skiller-web-henna.vercel.app.evil.example"
          }
        }))

        expect(response.status).toBe(403)
        expect(response.headers.get("access-control-allow-private-network")).toBeNull()
        expect(response.headers.get("access-control-allow-origin")).toBeNull()
      })
    ))
})
