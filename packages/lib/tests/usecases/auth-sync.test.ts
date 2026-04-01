import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  ensureClaudeAuthSeedFromHome,
  ensureCodexConfigFile,
  migrateLegacyOrchLayout,
  syncAuthArtifacts,
  syncGithubAuthKeys
} from "../../src/usecases/auth-sync.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-sync-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("syncGithubAuthKeys", () => {
  it("updates github token keys from source and preserves non-auth target keys", () => {
    const source = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_new",
      "GITHUB_TOKEN__WORK=token_work",
      "SOME_SOURCE_ONLY=value",
      ""
    ].join("\n")
    const target = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_old",
      "GH_TOKEN=legacy_old",
      "CUSTOM_FLAG=1",
      ""
    ].join("\n")

    const next = syncGithubAuthKeys(source, target)

    expect(next).toContain("GITHUB_TOKEN=token_new")
    expect(next).toContain("GITHUB_TOKEN__WORK=token_work")
    expect(next).not.toContain("GH_TOKEN=legacy_old")
    expect(next).toContain("CUSTOM_FLAG=1")
  })

  it("keeps target unchanged when source has no github token keys", () => {
    const source = [
      "# docker-git env",
      "# KEY=value",
      "UNRELATED=1",
      ""
    ].join("\n")
    const target = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_old",
      "CUSTOM_FLAG=1",
      ""
    ].join("\n")

    const next = syncGithubAuthKeys(source, target)

    expect(next).toBe(target)
  })

  it.effect("creates codex config with gpt-5.4 and long-context overrides", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const codexDir = path.join(root, ".orch", "auth", "codex")
        const configPath = path.join(codexDir, "config.toml")

        yield* _(ensureCodexConfigFile(root, ".orch/auth/codex"))

        const configText = yield* _(fs.readFileString(configPath))
        expect(configText).toContain("model = \"gpt-5.4\"")
        expect(configText).toContain("model_context_window = 1050000")
        expect(configText).toContain("model_auto_compact_token_limit = 945000")
        expect(configText).toContain("model_reasoning_effort = \"xhigh\"")
        expect(configText).toContain("plan_mode_reasoning_effort = \"xhigh\"")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rewrites managed codex config to include gpt-5.4 and plan mode xhigh", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const codexDir = path.join(root, ".orch", "auth", "codex")
        const configPath = path.join(codexDir, "config.toml")
        const legacyManagedConfig = [
          "# docker-git codex config",
          "model = \"gpt-5.3-codex\"",
          "model_reasoning_effort = \"xhigh\"",
          "personality = \"pragmatic\"",
          "",
          "approval_policy = \"never\"",
          "sandbox_mode = \"danger-full-access\"",
          "web_search = \"live\"",
          "",
          "[features]",
          "shell_snapshot = true",
          "multi_agent = true",
          "apps = true",
          "shell_tool = true",
          ""
        ].join("\n")

        yield* _(fs.makeDirectory(codexDir, { recursive: true }))
        yield* _(fs.writeFileString(configPath, legacyManagedConfig))
        yield* _(ensureCodexConfigFile(root, ".orch/auth/codex"))

        const next = yield* _(fs.readFileString(configPath))
        expect(next).toContain("model = \"gpt-5.4\"")
        expect(next).toContain("model_context_window = 1050000")
        expect(next).toContain("model_auto_compact_token_limit = 945000")
        expect(next).toContain("model_reasoning_effort = \"xhigh\"")
        expect(next).toContain("plan_mode_reasoning_effort = \"xhigh\"")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("ignores permission-denied codex config rewrites", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const codexDir = path.join(root, ".orch", "auth", "codex")
        const configPath = path.join(codexDir, "config.toml")
        const readOnlyConfig = [
          "# docker-git codex config",
          "model = \"gpt-5\"",
          ""
        ].join("\n")

        yield* _(fs.makeDirectory(codexDir, { recursive: true }))
        yield* _(fs.writeFileString(configPath, readOnlyConfig))
        yield* _(fs.chmod(configPath, 0o400))

        yield* _(ensureCodexConfigFile(root, ".orch/auth/codex"))

        const next = yield* _(fs.readFileString(configPath))
        expect(next).toBe(readOnlyConfig)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("migrates legacy claude auth directory into docker-git root", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const legacyClaudeDefault = path.join(root, ".orch", "auth", "claude", "default")
        const legacyTokenPath = path.join(legacyClaudeDefault, ".oauth-token")
        const ignoredTmpTokenPath = path.join(root, ".orch", "auth", "claude", "tmp", ".oauth-token")
        const expectedToken = "legacy-claude-token\n"

        yield* _(fs.makeDirectory(legacyClaudeDefault, { recursive: true }))
        yield* _(fs.writeFileString(legacyTokenPath, expectedToken))
        yield* _(fs.makeDirectory(path.dirname(ignoredTmpTokenPath), { recursive: true }))
        yield* _(fs.writeFileString(ignoredTmpTokenPath, "ignored-claude-token\n"))

        yield* _(
          migrateLegacyOrchLayout(root, {
            envGlobalPath: ".docker-git/.orch/env/global.env",
            envProjectPath: ".orch/env/project.env",
            codexAuthPath: ".docker-git/.orch/auth/codex",
            ghAuthPath: ".docker-git/.orch/auth/gh",
            claudeAuthPath: ".docker-git/.orch/auth/claude"
          })
        )

        const migratedTokenPath = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "claude",
          "default",
          ".oauth-token"
        )
        const migratedToken = yield* _(fs.readFileString(migratedTokenPath))
        const migratedTmpTokenPath = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "claude",
          "tmp",
          ".oauth-token"
        )
        const hasMigratedTmpToken = yield* _(fs.exists(migratedTmpTokenPath))
        expect(migratedToken).toBe(expectedToken)
        expect(hasMigratedTmpToken).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("seeds Claude auth from host home into docker-git default account", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const hostHome = path.join(root, "host-home")
        const hostClaudeDir = path.join(hostHome, ".claude")
        const hostClaudeJson = path.join(hostHome, ".claude.json")
        const hostCredentialsJson = path.join(hostClaudeDir, ".credentials.json")

        yield* _(fs.makeDirectory(hostClaudeDir, { recursive: true }))
        yield* _(
          fs.writeFileString(
            hostClaudeJson,
            JSON.stringify(
              {
                oauthAccount: { accountUuid: "acc-1" },
                userID: "user-1"
              },
              null,
              2
            )
          )
        )
        yield* _(
          fs.writeFileString(
            hostCredentialsJson,
            JSON.stringify(
              {
                claudeAiOauth: { accessToken: "token-1" }
              },
              null,
              2
            )
          )
        )

        const previousHome = process.env["HOME"]
        yield* _(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previousHome === undefined) {
                delete process.env["HOME"]
              } else {
                process.env["HOME"] = previousHome
              }
            })
          )
        )
        yield* _(Effect.sync(() => {
          process.env["HOME"] = hostHome
        }))

        yield* _(ensureClaudeAuthSeedFromHome(root, ".docker-git/.orch/auth/claude"))

        const seededClaudeJson = path.join(root, ".docker-git", ".orch", "auth", "claude", "default", ".claude.json")
        const seededCredentials = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "claude",
          "default",
          ".credentials.json"
        )

        const seededJsonText = yield* _(fs.readFileString(seededClaudeJson))
        const seededCredentialsText = yield* _(fs.readFileString(seededCredentials))
        expect(seededJsonText).toContain("\"oauthAccount\"")
        expect(seededCredentialsText).toContain("\"claudeAiOauth\"")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("skips broken Claude debug symlinks during auth bootstrap sync", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const sourceRoot = path.join(root, "source")
        const targetRoot = path.join(root, "target")
        const sourceClaudeDefault = path.join(sourceRoot, ".orch", "auth", "claude", "default")
        const sourceDebugDir = path.join(sourceClaudeDefault, "debug")
        const targetClaudeDefault = path.join(targetRoot, ".orch", "auth", "claude", "default")

        yield* _(fs.makeDirectory(sourceDebugDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceClaudeDefault, ".oauth-token"), "token-1\n"))
        yield* _(fs.symlink("/claude-home/debug/missing.txt", path.join(sourceDebugDir, "latest")))

        yield* _(
          syncAuthArtifacts({
            sourceBase: sourceRoot,
            targetBase: targetRoot,
            source: {
              envGlobalPath: ".orch/env/global.env",
              envProjectPath: ".orch/env/project.env",
              codexAuthPath: ".orch/auth/codex",
              claudeAuthPath: ".orch/auth/claude"
            },
            target: {
              envGlobalPath: ".orch/env/global.env",
              envProjectPath: ".orch/env/project.env",
              codexAuthPath: ".orch/auth/codex",
              claudeAuthPath: ".orch/auth/claude"
            }
          })
        )

        const copiedOauthToken = yield* _(fs.readFileString(path.join(targetClaudeDefault, ".oauth-token")))
        const copiedLatest = yield* _(fs.exists(path.join(targetClaudeDefault, "debug", "latest")))
        expect(copiedOauthToken).toBe("token-1\n")
        expect(copiedLatest).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not reseed Claude session credentials when oauth token already exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const hostHome = path.join(root, "host-home")
        const hostClaudeDir = path.join(hostHome, ".claude")
        const hostClaudeJson = path.join(hostHome, ".claude.json")
        const hostCredentialsJson = path.join(hostClaudeDir, ".credentials.json")
        const targetAccountDir = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "claude",
          "default"
        )
        const targetOauthToken = path.join(targetAccountDir, ".oauth-token")
        const targetCredentials = path.join(targetAccountDir, ".credentials.json")

        yield* _(fs.makeDirectory(hostClaudeDir, { recursive: true }))
        yield* _(fs.makeDirectory(targetAccountDir, { recursive: true }))
        yield* _(fs.writeFileString(targetOauthToken, "oauth-token-value\n"))
        yield* _(
          fs.writeFileString(
            hostClaudeJson,
            JSON.stringify(
              {
                oauthAccount: { accountUuid: "acc-2" },
                userID: "user-2"
              },
              null,
              2
            )
          )
        )
        yield* _(
          fs.writeFileString(
            hostCredentialsJson,
            JSON.stringify(
              {
                claudeAiOauth: { accessToken: "token-2" }
              },
              null,
              2
            )
          )
        )

        const previousHome = process.env["HOME"]
        yield* _(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previousHome === undefined) {
                delete process.env["HOME"]
              } else {
                process.env["HOME"] = previousHome
              }
            })
          )
        )
        yield* _(Effect.sync(() => {
          process.env["HOME"] = hostHome
        }))

        yield* _(ensureClaudeAuthSeedFromHome(root, ".docker-git/.orch/auth/claude"))

        const hasSeededCredentials = yield* _(fs.exists(targetCredentials))
        expect(hasSeededCredentials).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
