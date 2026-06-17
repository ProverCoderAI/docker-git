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

const failOnCopyFile = (
  fs: FileSystem.FileSystem,
  label: string
): FileSystem.FileSystem => ({
  ...fs,
  copyFile: () => Effect.dieMessage(`${label}: unexpected copyFile`)
})

describe("syncGithubAuthKeys", () => {
  it("updates github token keys from source and preserves non-auth target keys", () => {
    const source = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_new",
      "GITHUB_TOKEN__WORK=token_work",
      "GITLAB_TOKEN__WORK=gitlab_token_work",
      "SOME_SOURCE_ONLY=value",
      ""
    ].join("\n")
    const target = [
      "# docker-git env",
      "# KEY=value",
      "GITHUB_TOKEN=token_old",
      "GH_TOKEN=legacy_old",
      "GITLAB_TOKEN=gitlab_old",
      "CUSTOM_FLAG=1",
      ""
    ].join("\n")

    const next = syncGithubAuthKeys(source, target)

    expect(next).toContain("GITHUB_TOKEN=token_new")
    expect(next).toContain("GITHUB_TOKEN__WORK=token_work")
    expect(next).toContain("GITLAB_TOKEN__WORK=gitlab_token_work")
    expect(next).not.toContain("GH_TOKEN=legacy_old")
    expect(next).not.toContain("GITLAB_TOKEN=gitlab_old")
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

  it.effect("creates codex config with gpt-5.5 and long-context overrides", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const codexDir = path.join(root, ".orch", "auth", "codex")
        const configPath = path.join(codexDir, "config.toml")

        yield* _(ensureCodexConfigFile(root, ".orch/auth/codex"))

        const configText = yield* _(fs.readFileString(configPath))
        expect(configText).toContain("model = \"gpt-5.5\"")
        expect(configText).toContain("model_context_window = 1050000")
        expect(configText).toContain("model_auto_compact_token_limit = 945000")
        expect(configText).toContain("model_reasoning_effort = \"xhigh\"")
        expect(configText).toContain("plan_mode_reasoning_effort = \"xhigh\"")
        // issue #410: the unused codex_app.github connector must be disabled
        expect(configText).toContain("[apps.github]")
        expect(configText).toContain("enabled = false")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("copies Codex auth.json into the target auth dir", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const sourceBase = path.join(root, "source")
        const targetBase = path.join(root, "target")
        const sourceCodexDir = path.join(sourceBase, ".orch", "auth", "codex")
        const targetCodexDir = path.join(targetBase, ".orch", "auth", "codex")
        const authText = JSON.stringify({ openai: { type: "oauth", refresh: "refresh", access: "access" } }, null, 2)

        yield* _(fs.makeDirectory(sourceCodexDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceCodexDir, "auth.json"), authText))

        yield* _(
          syncAuthArtifacts({
            sourceBase,
            targetBase,
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

        const copiedAuthText = yield* _(fs.readFileString(path.join(targetCodexDir, "auth.json")))
        expect(copiedAuthText).toBe(authText)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("overwrites stale Codex auth.json in the target auth dir", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const sourceBase = path.join(root, "source")
        const targetBase = path.join(root, "target")
        const sourceCodexDir = path.join(sourceBase, ".orch", "auth", "codex")
        const targetCodexDir = path.join(targetBase, ".orch", "auth", "codex")
        const sourceAuthText = JSON.stringify({ tokens: { account_id: "new-account" } }, null, 2)
        const targetAuthText = JSON.stringify({ tokens: { account_id: "old-account" } }, null, 2)

        yield* _(fs.makeDirectory(sourceCodexDir, { recursive: true }))
        yield* _(fs.makeDirectory(targetCodexDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceCodexDir, "auth.json"), sourceAuthText))
        yield* _(fs.writeFileString(path.join(targetCodexDir, "auth.json"), targetAuthText))

        yield* _(
          syncAuthArtifacts({
            sourceBase,
            targetBase,
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

        const copiedAuthText = yield* _(fs.readFileString(path.join(targetCodexDir, "auth.json")))
        expect(copiedAuthText).toBe(sourceAuthText)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("replaces a dangling Codex auth symlink with a regular snapshot file", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const sourceBase = path.join(root, "source")
        const targetBase = path.join(root, "target")
        const sourceCodexDir = path.join(sourceBase, ".orch", "auth", "codex")
        const targetCodexDir = path.join(targetBase, ".orch", "auth", "codex")
        const targetAuthPath = path.join(targetBase, ".orch", "auth", "codex", "auth.json")
        const missingSharedAuthPath = path.join(root, "missing-shared", "auth.json")
        const authText = JSON.stringify({ tokens: { account_id: "retry-account" } }, null, 2)

        yield* _(fs.makeDirectory(sourceCodexDir, { recursive: true }))
        yield* _(fs.makeDirectory(targetCodexDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceCodexDir, "auth.json"), authText))
        yield* _(fs.symlink(missingSharedAuthPath, targetAuthPath))

        yield* _(
          syncAuthArtifacts({
            sourceBase,
            targetBase,
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

        expect(yield* _(fs.readFileString(targetAuthPath))).toBe(authText)
        const targetInfo = yield* _(fs.stat(targetAuthPath))
        expect(targetInfo.type).toBe("File")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("syncs env, Codex auth, and Claude auth without low-level copyFile", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const sourceBase = path.join(root, "source")
        const targetBase = path.join(root, "target")
        const sourceCodexDir = path.join(sourceBase, ".orch", "auth", "codex")
        const sourceClaudeDefault = path.join(sourceBase, ".orch", "auth", "claude", "default")
        const sourceEnvDir = path.join(sourceBase, ".orch", "env")

        yield* _(fs.makeDirectory(sourceCodexDir, { recursive: true }))
        yield* _(fs.makeDirectory(sourceClaudeDefault, { recursive: true }))
        yield* _(fs.makeDirectory(sourceEnvDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceEnvDir, "global.env"), "GITHUB_TOKEN=test-token\n"))
        yield* _(fs.writeFileString(path.join(sourceEnvDir, "project.env"), "CODEX_SHARE_AUTH=1\n"))
        yield* _(fs.writeFileString(path.join(sourceCodexDir, "auth.json"), "{\"account\":\"codex\"}\n"))
        yield* _(fs.writeFileString(path.join(sourceClaudeDefault, ".oauth-token"), "claude-token\n"))

        yield* _(
          syncAuthArtifacts({
            sourceBase,
            targetBase,
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
          }).pipe(Effect.provideService(FileSystem.FileSystem, failOnCopyFile(fs, "syncAuthArtifacts")))
        )

        expect(yield* _(fs.readFileString(path.join(targetBase, ".orch", "env", "global.env")))).toContain(
          "GITHUB_TOKEN=test-token"
        )
        expect(yield* _(fs.readFileString(path.join(targetBase, ".orch", "env", "project.env")))).toContain(
          "CODEX_SHARE_AUTH=1"
        )
        expect(yield* _(fs.readFileString(path.join(targetBase, ".orch", "auth", "codex", "auth.json")))).toBe(
          "{\"account\":\"codex\"}\n"
        )
        expect(
          yield* _(fs.readFileString(path.join(targetBase, ".orch", "auth", "claude", "default", ".oauth-token")))
        ).toBe("claude-token\n")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("rewrites managed codex config to include gpt-5.5 and plan mode xhigh", () =>
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
        expect(next).toContain("model = \"gpt-5.5\"")
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

  it.effect("migrates legacy Grok auth directory into docker-git root", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const legacyGrokDefault = path.join(root, ".orch", "auth", "grok", "default")
        const legacyGrokHome = path.join(legacyGrokDefault, ".grok")

        yield* _(fs.makeDirectory(legacyGrokHome, { recursive: true }))
        yield* _(fs.writeFileString(path.join(legacyGrokDefault, ".api-key"), "xai-legacy\n"))
        yield* _(fs.writeFileString(path.join(legacyGrokHome, "auth.json"), "{\"oauth\":\"legacy\"}\n"))

        yield* _(
          migrateLegacyOrchLayout(root, {
            envGlobalPath: ".docker-git/.orch/env/global.env",
            envProjectPath: ".orch/env/project.env",
            codexAuthPath: ".docker-git/.orch/auth/codex",
            ghAuthPath: ".docker-git/.orch/auth/gh",
            claudeAuthPath: ".docker-git/.orch/auth/claude",
            grokAuthPath: ".docker-git/.orch/auth/grok"
          })
        )

        const migratedGrokDefault = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "grok",
          "default"
        )
        expect(yield* _(fs.readFileString(path.join(migratedGrokDefault, ".api-key")))).toBe("xai-legacy\n")
        expect(yield* _(fs.readFileString(path.join(migratedGrokDefault, ".grok", "auth.json")))).toBe(
          "{\"oauth\":\"legacy\"}\n"
        )
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

  it.effect("seeds Claude auth from host home without low-level copyFile", () =>
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
                oauthAccount: { accountUuid: "acc-guard" },
                userID: "user-guard"
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
                claudeAiOauth: { accessToken: "token-guard" }
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

        yield* _(
          ensureClaudeAuthSeedFromHome(root, ".docker-git/.orch/auth/claude").pipe(
            Effect.provideService(FileSystem.FileSystem, failOnCopyFile(fs, "ensureClaudeAuthSeedFromHome"))
          )
        )

        const targetClaudeJson = path.join(root, ".docker-git", ".orch", "auth", "claude", "default", ".claude.json")
        const targetCredentials = path.join(
          root,
          ".docker-git",
          ".orch",
          "auth",
          "claude",
          "default",
          ".credentials.json"
        )

        expect(yield* _(fs.readFileString(targetClaudeJson))).toContain("\"oauthAccount\"")
        expect(yield* _(fs.readFileString(targetCredentials))).toContain("\"claudeAiOauth\"")
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
