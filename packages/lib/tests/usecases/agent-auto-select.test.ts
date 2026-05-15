import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { resolveAutoAgentMode } from "../../src/usecases/agent-auto-select.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auto-agent-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeConfig = (root: string, path: Path.Path): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "issue-119",
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex"),
  codexHome: "/home/dev/.codex",
  geminiAuthPath: path.join(root, ".orch/auth/gemini"),
  geminiHome: "/home/dev/.gemini",
  grokAuthPath: path.join(root, ".orch/auth/grok"),
  grokHome: "/home/dev/.grok",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  gpu: "none",
  bunVersion: "1.3.11",
  agentAuto: true
})

describe("resolveAutoAgentMode", () => {
  it.effect("chooses Claude when only Claude auth exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)
        const claudeRoot = path.join(root, ".orch/auth/claude/default")

        yield* _(fs.makeDirectory(claudeRoot, { recursive: true }))
        yield* _(fs.writeFileString(path.join(claudeRoot, ".oauth-token"), "token\n"))

        const mode = yield* _(resolveAutoAgentMode(config))
        expect(mode).toBe("claude")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("keeps explicit Claude mode when Claude auth exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config: TemplateConfig = { ...makeConfig(root, path), agentMode: "claude" }
        const claudeRoot = path.join(root, ".orch/auth/claude/default")

        yield* _(fs.makeDirectory(claudeRoot, { recursive: true }))
        yield* _(fs.writeFileString(path.join(claudeRoot, ".oauth-token"), "token\n"))

        const mode = yield* _(resolveAutoAgentMode(config))
        expect(mode).toBe("claude")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("chooses Codex when only Codex auth exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)
        const codexRoot = path.join(root, ".orch/auth/codex")

        yield* _(fs.makeDirectory(codexRoot, { recursive: true }))
        yield* _(fs.writeFileString(path.join(codexRoot, "auth.json"), "{\"ok\":true}\n"))

        const mode = yield* _(resolveAutoAgentMode(config))
        expect(mode).toBe("codex")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("keeps explicit Codex mode when Codex auth exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config: TemplateConfig = { ...makeConfig(root, path), agentMode: "codex" }
        const codexRoot = path.join(root, ".orch/auth/codex")

        yield* _(fs.makeDirectory(codexRoot, { recursive: true }))
        yield* _(fs.writeFileString(path.join(codexRoot, "auth.json"), "{\"ok\":true}\n"))

        const mode = yield* _(resolveAutoAgentMode(config))
        expect(mode).toBe("codex")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("returns one of the available agents when both Claude and Codex auth exist", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)
        const claudeRoot = path.join(root, ".orch/auth/claude/default")
        const codexRoot = path.join(root, ".orch/auth/codex")

        yield* _(fs.makeDirectory(claudeRoot, { recursive: true }))
        yield* _(fs.makeDirectory(codexRoot, { recursive: true }))
        yield* _(fs.writeFileString(path.join(claudeRoot, ".oauth-token"), "token\n"))
        yield* _(fs.writeFileString(path.join(codexRoot, "auth.json"), "{\"ok\":true}\n"))

        const mode = yield* _(resolveAutoAgentMode(config))
        expect(["claude", "codex"]).toContain(mode)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails explicit Claude mode when Claude auth is missing", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const config: TemplateConfig = { ...makeConfig(root, path), agentMode: "claude" }

        const exit = yield* _(
          resolveAutoAgentMode(config).pipe(
            Effect.flip,
            Effect.map((error) => error._tag)
          )
        )
        expect(exit).toBe("InvalidOption")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails explicit Codex mode when Codex auth is missing", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const config: TemplateConfig = { ...makeConfig(root, path), agentMode: "codex" }

        const exit = yield* _(
          resolveAutoAgentMode(config).pipe(
            Effect.flip,
            Effect.map((error) => error._tag)
          )
        )
        expect(exit).toBe("InvalidOption")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails when no auth exists", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const config = makeConfig(root, path)

        const exit = yield* _(
          resolveAutoAgentMode(config).pipe(
            Effect.flip,
            Effect.map((error) => error._tag)
          )
        )
        expect(exit).toBe("InvalidOption")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
