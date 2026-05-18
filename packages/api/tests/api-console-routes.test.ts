import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { makeRouter } from "../src/http.js"

const apiHandler = HttpApp.toWebHandler(
  Effect.provide(Effect.flatten(HttpRouter.toHttpApp(makeRouter())), NodeContext.layer)
)

const requestApiRoute = (path: string) =>
  Effect.tryPromise({
    try: () => apiHandler(new Request(`http://127.0.0.1${path}`)),
    catch: (cause) => new Error(String(cause))
  })

describe("api console routes", () => {
  it.effect("does not serve the legacy built-in API console", () =>
    Effect.gen(function*(_) {
      const routes = ["/", "/ui/styles.css", "/ui/app.js"] as const

      for (const route of routes) {
        const response = yield* _(requestApiRoute(route))
        expect(response.status).toBe(404)
      }
    }))
})
