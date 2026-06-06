import * as HttpApp from "@effect/platform/HttpApp"
import * as HttpRouter from "@effect/platform/HttpRouter"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import type { PlatformError } from "@effect/platform/Error"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"
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

const HealthResponseSchema = Schema.Struct({
  cwd: Schema.String,
  ok: Schema.Boolean,
  projectsRoot: Schema.String,
  revision: Schema.NullOr(Schema.String)
})

type HealthResponse = Schema.Schema.Type<typeof HealthResponseSchema>

/**
 * Creates a scoped temporary directory and provides its path to the supplied effect.
 *
 * @param use - Effect factory that receives the temporary directory path.
 * @returns Effect that yields the factory result and finalizes the temporary directory scope.
 *
 * @pure false
 * @effect FileSystem service for scoped directory allocation and cleanup
 * @invariant the temporary directory lifetime is bounded by the returned Effect scope
 * @precondition FileSystem service is available in the environment
 * @postcondition the temporary directory scope is finalized after success or failure
 * @complexity O(1) allocation; cleanup is O(n) in created filesystem entries
 * @throws Never - filesystem and user errors are represented in the Effect error channel
 */
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

/**
 * Temporarily sets or unsets an environment variable for the duration of an effect.
 *
 * @param key - Environment variable name to modify.
 * @param value - Temporary value, or undefined to remove the variable.
 * @param effect - Effect evaluated while the temporary environment binding is active.
 * @returns Effect that yields the supplied effect result and restores the previous binding.
 *
 * @pure false
 * @effect process environment mutation inside acquire/release
 * @invariant the previous environment value is restored exactly once during finalization
 * @precondition key is a non-empty environment variable name accepted by the runtime
 * @postcondition process.env[key] equals its previous value after the scope finalizes
 * @complexity O(1) time and space
 * @throws Never - user effect errors are represented in the Effect error channel
 */
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

const readHealthResponse = (response: Response): Effect.Effect<HealthResponse, Error | ParseResult.ParseError> =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new Error(String(cause))
  }).pipe(Effect.flatMap(Schema.decodeUnknown(HealthResponseSchema)))

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
        const payload = yield* _(readHealthResponse(response))

        expect(response.status).toBe(200)
        expect(payload.projectsRoot).toBe(projectsRoot)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
