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

const requestApiRoute = (path: string, init: RequestInit) =>
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
