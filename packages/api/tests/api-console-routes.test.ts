import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import type { PlatformError } from "@effect/platform/Error"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Scope from "effect/Scope"

import { makeRouter } from "../src/http.js"

const apiHandler = HttpApp.toWebHandler(
  Effect.provide(Effect.flatten(HttpRouter.toHttpApp(makeRouter())), NodeContext.layer)
)

const requestApiRoute = (path: string) =>
  Effect.tryPromise({
    try: () => apiHandler(new Request(`http://127.0.0.1${path}`)),
    catch: (cause) => new Error(String(cause))
  })

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-api-routes-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withEnvVar = <A, E, R>(
  key: string,
  value: string | undefined,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env[key]
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
        return previous
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = previous
          }
        })
    ).pipe(Effect.flatMap(() => effect))
  )

const readResponseJson = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new Error(String(cause))
  })

const objectOrNull = (value: unknown): object | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null

describe("api console routes", () => {
  it.effect("does not serve the legacy built-in API console", () =>
    Effect.gen(function*(_) {
      const routes = ["/", "/ui/styles.css", "/ui/app.js"] as const

      for (const route of routes) {
        const response = yield* _(requestApiRoute(route))
        expect(response.status).toBe(404)
      }
    }))

  it.effect("reports the same configured projects root used by inventory reads", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const response = yield* _(
          withEnvVar("DOCKER_GIT_PROJECTS_ROOT", projectsRoot, requestApiRoute("/health"))
        )
        const payload = yield* _(readResponseJson(response))
        const objectPayload = objectOrNull(payload)

        expect(response.status).toBe(200)
        expect(objectPayload).not.toBeNull()
        expect(Reflect.get(objectPayload ?? {}, "projectsRoot")).toBe(projectsRoot)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
