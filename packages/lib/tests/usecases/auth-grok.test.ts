import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import { authGrokLogin } from "../../src/usecases/auth-grok.js"
import { buildDockerGrokAuthArgs } from "../../src/usecases/auth-grok-oauth.js"
import {
  grokCliInstallScriptUrl,
  grokCliVersion,
  hasGrokCredentials,
  renderGrokDockerfile
} from "../../src/usecases/auth-grok-helpers.js"

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

const detectUserSettingsPayload = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string,
  payload: object
) =>
  Effect.gen(function*(_) {
    const credentialsDir = path.join(accountPath, ".grok")
    yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
    yield* _(
      fs.writeFileString(
        path.join(credentialsDir, "user-settings.json"),
        `${JSON.stringify(payload)}\n`
      )
    )
    return yield* _(hasGrokCredentials(fs, accountPath))
  })

const grokOidcAuthScope = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828"
const grokLegacyAuthScope = "https://accounts.x.ai/sign-in"

describe("authGrokLogin", () => {
  it("installs the official xAI Grok CLI in the OAuth helper image", () => {
    const dockerfile = renderGrokDockerfile()

    expect(dockerfile).toContain(grokCliInstallScriptUrl)
    expect(dockerfile).toContain(`GROK_BIN_DIR=/usr/local/bin bash /tmp/grok-install.sh ${grokCliVersion}`)
    expect(dockerfile).toContain("grok --version")
    expect(dockerfile).not.toContain("grok-dev")
    expect(dockerfile).not.toContain("npm install -g grok-dev")
  })

  it("uses the official Grok device-auth login mode", () => {
    const args = buildDockerGrokAuthArgs({
      cwd: "/workspace",
      image: "docker-git-auth-grok:latest",
      hostPath: "/host/grok",
      containerPath: "/grok-home",
      env: ["HOME=/grok-home", "MCP_PLAYWRIGHT_ISOLATED=1"]
    })

    expect(args).toContain("MCP_PLAYWRIGHT_ISOLATED=1")
    expect(args).not.toContain("NO_BROWSER=true")
    expect(args).not.toContain("GROK_NO_BROWSER=true")
    expect(args.slice(-4)).toEqual(["docker-git-auth-grok:latest", "grok", "login", "--device-auth"])
  })

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
          const apiKeyInfo = yield* _(fs.stat(path.join(accountPath, ".api-key")))
          const credentialsInfo = yield* _(fs.stat(path.join(accountPath, ".grok")))
          const userSettings = JSON.parse(
            yield* _(fs.readFileString(path.join(accountPath, ".grok", "user-settings.json")))
          )
          const projectSettings = JSON.parse(
            yield* _(fs.readFileString(path.join(accountPath, ".grok", "settings.json")))
          )

          expect(apiKey).toBe("xai-test-api-key\n")
          expect(Number(apiKeyInfo.mode ?? 0) & 0o777).toBe(0o600)
          expect(Number(credentialsInfo.mode ?? 0) & 0o777).toBe(0o700)
          expect(userSettings.apiKey).toBe("xai-test-api-key")
          expect(userSettings.sandboxMode).toBe("off")
          expect(projectSettings.mcpServers.playwright.command).toBe("docker-git-playwright-mcp")
          expect(projectSettings.mcpServers.playwright.trust).toBe(true)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rejects empty API keys", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0"
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const grokAuthPath = path.join(root, ".docker-git/.orch/auth/grok")

          const errors = yield* _(
            Effect.forEach(
              ["", "   "],
              (apiKey) =>
                authGrokLogin(
                  {
                    _tag: "AuthGrokLogin",
                    label: "empty-key",
                    grokAuthPath,
                    isWeb: false
                  },
                  apiKey
                ).pipe(
                  Effect.provideService(FileSystem.FileSystem, fs),
                  Effect.provideService(Path.Path, path),
                  Effect.flip
                )
            )
          )

          for (const error of errors) {
            expect(error._tag).toBe("AuthError")
            if (error._tag === "AuthError") {
              expect(error.message).toBe("Grok API key must not be empty")
            }
          }
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

  it.effect("detects nested oauth user settings as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")

        const detected = yield* _(
          detectUserSettingsPayload(fs, path, accountPath, {
            oauth: {
              meta: {},
              accessToken: "oauth-token"
            }
          })
        )
        expect(detected).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("detects official Grok auth.json as OAuth credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".grok")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(
          fs.writeFileString(path.join(credentialsDir, "auth.json"), `${JSON.stringify({ [grokOidcAuthScope]: { key: "xai-oauth" } })}\n`)
        )

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(true)

        yield* _(
          fs.writeFileString(path.join(credentialsDir, "auth.json"), `${JSON.stringify({ [grokLegacyAuthScope]: { key: "xai-legacy" } })}\n`)
        )

        const legacyDetected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(legacyDetected).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not treat unrelated auth.json tokens as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".grok")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(credentialsDir, "auth.json"), "{\"scope\":{\"key\":\"xai-oauth\"},\"token\":\"nope\"}\n"))

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("detects official Grok deployment key env files", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")

        yield* _(fs.makeDirectory(accountPath, { recursive: true }))
        yield* _(fs.writeFileString(path.join(accountPath, ".env"), "GROK_DEPLOYMENT_KEY='xai-deploy'\n"))

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not treat bootstrap user settings as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".grok")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(credentialsDir, "user-settings.json"),
            "{\"sandboxMode\":\"off\",\"confirmBeforeToolUse\":false}\n"
          )
        )

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not treat empty oauth with unrelated token as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".grok")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(
          fs.writeFileString(
            path.join(credentialsDir, "user-settings.json"),
            "{\"oauth\":{},\"telemetry\":{\"token\":\"not-oauth\"}}\n"
          )
        )

        const detected = yield* _(hasGrokCredentials(fs, accountPath))
        expect(detected).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("detects generated user settings with apiKey as Grok credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")

        yield* _(
          Effect.tryPromise({
            catch: (error) => error,
            try: () =>
              fc.assert(
                fc.asyncProperty(
                  fc.tuple(
                    fc.string({ minLength: 1 }).filter((value) => value.trim().length > 0),
                    fc.boolean(),
                    fc.constantFrom("off", "on")
                  ),
                  ([apiKey, confirmBeforeToolUse, sandboxMode]) =>
                    Effect.runPromise(
                      detectUserSettingsPayload(fs, path, accountPath, {
                        apiKey,
                        confirmBeforeToolUse,
                        sandboxMode
                      }).pipe(
                        Effect.map((detected) => {
                          expect(detected).toBe(true)
                        })
                      )
                    )
                ),
                { numRuns: 25 }
              )
          })
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rejects generated bootstrap-like user settings without apiKey", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")

        yield* _(
          Effect.tryPromise({
            catch: (error) => error,
            try: () =>
              fc.assert(
                fc.asyncProperty(
                  fc.tuple(
                    fc.boolean(),
                    fc.boolean(),
                    fc.constantFrom("off", "on"),
                    fc.constantFrom(
                      {},
                      { token: "" },
                      { accessToken: "" },
                      { refreshToken: "" }
                    )
                  ),
                  ([includeConfirmBeforeToolUse, includeOauth, sandboxMode, oauth]) =>
                    Effect.runPromise(
                      detectUserSettingsPayload(fs, path, accountPath, {
                        sandboxMode,
                        ...(includeConfirmBeforeToolUse ? { confirmBeforeToolUse: false } : {}),
                        ...(includeOauth ? { oauth } : {})
                      }).pipe(
                        Effect.map((detected) => {
                          expect(detected).toBe(false)
                        })
                      )
                    )
                ),
                { numRuns: 25 }
              )
          })
        )
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
