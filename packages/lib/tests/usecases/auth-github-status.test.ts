import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import { vi } from "vitest"

import { authGithubStatus } from "../../src/usecases/auth-github.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-github-status-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withPatchedFetch = <A, E, R>(
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

const runStatusAndCollectLogs = (
  root: string,
  envText: string,
  fetchImpl: typeof globalThis.fetch
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const logs: Array<string> = []
    const envGlobalPath = path.join(root, ".orch", "env", "global.env")
    const logger = Logger.make(({ message }) => {
      logs.push(String(message))
    })

    yield* _(fs.makeDirectory(path.join(root, ".orch", "env"), { recursive: true }))
    yield* _(fs.writeFileString(envGlobalPath, envText))
    yield* _(
      withPatchedFetch(
        fetchImpl,
        authGithubStatus({
          _tag: "AuthGithubStatus",
          envGlobalPath
        }).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger)))
      )
    )

    return logs
  })

describe("auth github status", () => {
  it.effect("prints owner login for a valid GitHub token", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(
            Effect.succeed(
              new Response(JSON.stringify({ login: "octocat" }), {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              })
            )
          )
        )

        const logs = yield* _(
          runStatusAndCollectLogs(
            root,
            [
              "# docker-git env",
              "GITHUB_TOKEN=live-token",
              ""
            ].join("\n"),
            fetchMock
          )
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(logs).toEqual(["GitHub tokens (1):\n- default: valid (owner: octocat)"])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("prints invalid when GitHub rejects the token", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(Effect.succeed(new Response(null, { status: 401 })))
        )

        const logs = yield* _(
          runStatusAndCollectLogs(
            root,
            [
              "# docker-git env",
              "GITHUB_TOKEN=dead-token",
              ""
            ].join("\n"),
            fetchMock
          )
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(logs).toEqual(["GitHub tokens (1):\n- default: invalid"])
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("prints unknown when validation cannot determine token state", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
          Effect.runPromise(Effect.succeed(new Response(null, { status: 500 })))
        )

        const logs = yield* _(
          runStatusAndCollectLogs(
            root,
            [
              "# docker-git env",
              "GITHUB_TOKEN=maybe-token",
              ""
            ].join("\n"),
            fetchMock
          )
        )

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(logs).toEqual(["GitHub tokens (1):\n- default: unknown (validation unavailable)"])
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
