import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { authGrokLogin } from "../../src/usecases/auth-grok.js"
import { hasGrokCredentials } from "../../src/usecases/auth-grok-helpers.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-grok-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(patch)) {
        previous.set(key, process.env[key])
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous.entries()) {
          if (value === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = value
          }
        }
      })
  )

describe("authGrokLogin", () => {
  it.effect("stores API key and writes Grok settings with Playwright MCP and no sandbox", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0"
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const grokAuthPath = ".docker-git/.orch/auth/grok"
          const accountLabel = "test-account"
          const absoluteGrokAuthPath = path.join(root, grokAuthPath)

          yield* _(
            authGrokLogin(
              {
                _tag: "AuthGrokLogin",
                label: accountLabel,
                grokAuthPath: absoluteGrokAuthPath,
                isWeb: false
              },
              "xai-test-api-key"
            ).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path)
            )
          )

          const accountPath = path.join(absoluteGrokAuthPath, accountLabel)
          const apiKey = yield* _(fs.readFileString(path.join(accountPath, ".api-key")))
          const userSettings = JSON.parse(
            yield* _(fs.readFileString(path.join(accountPath, ".grok", "user-settings.json")))
          )
          const projectSettings = JSON.parse(
            yield* _(fs.readFileString(path.join(accountPath, ".grok", "settings.json")))
          )

          expect(apiKey).toBe("xai-test-api-key\n")
          expect(userSettings.apiKey).toBe("xai-test-api-key")
          expect(userSettings.sandboxMode).toBe("off")
          expect(projectSettings.mcpServers.playwright.command).toBe("docker-git-playwright-mcp")
          expect(projectSettings.mcpServers.playwright.trust).toBe(true)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("detects user-settings.json as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".grok")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(credentialsDir, "user-settings.json"), "{\"apiKey\":\"xai-test\"}\n"))

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
