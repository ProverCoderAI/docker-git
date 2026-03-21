import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { authGeminiLogin, geminiAuthRoot } from "../../src/usecases/auth-gemini.js"
import { hasOauthCredentials } from "../../src/usecases/auth-gemini-helpers.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-gemini-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("authGeminiLogin", () => {
  it.effect("generates settings.json with correct 1:1 configuration", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        
        // Mock the environment by setting the auth path to our temp root
        const geminiAuthPath = ".docker-git/.orch/auth/gemini"
        const accountLabel = "test-account"
        // In the real app, resolvePathFromCwd is used. 
        // For the test, we'll bypass the complex resolution and check if we can call the core logic.
        // However, authGeminiLogin calls withGeminiAuth which calls ensureGeminiOrchLayout.
        // We need to be careful with where it writes.
        
        // Let's mock the command to use our temp root as the 'geminiAuthPath'
        const relativeGeminiAuthPath = path.join(root, geminiAuthPath)

        yield* _(
          authGeminiLogin(
            {
              _tag: "AuthGeminiLogin",
              label: accountLabel,
              geminiAuthPath: relativeGeminiAuthPath,
              isWeb: false
            },
            "test-api-key"
          ).pipe(
             Effect.provideService(FileSystem.FileSystem, fs),
             Effect.provideService(Path.Path, path)
          )
        )

        const settingsPath = path.join(relativeGeminiAuthPath, accountLabel, ".gemini", "settings.json")
        const settingsContent = yield* _(fs.readFileString(settingsPath))
        const settings = JSON.parse(settingsContent)

        expect(settings.model.name).toBe("gemini-3.1-pro-preview")
        expect(settings.modelConfigs.customAliases["yolo-ultra"]).toBeDefined()
        expect(settings.general.defaultApprovalMode).toBe("auto_edit")
        expect(settings.mcpServers.playwright.command).toBe("docker-git-playwright-mcp")
        expect(settings.security.folderTrust.enabled).toBe(false)
        expect(settings.tools.allowed).toContain("googleSearch")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("detects oauth_creds.json as valid Gemini OAuth credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const accountPath = path.join(root, "default")
        const credentialsDir = path.join(accountPath, ".gemini")

        yield* _(fs.makeDirectory(credentialsDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(credentialsDir, "oauth_creds.json"), "{\"access_token\":\"test\"}\n"))

        const detected = yield* _(hasOauthCredentials(fs, accountPath))
        expect(detected).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
