import * as fs from "node:fs"

import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { stageBootstrapSnapshot } from "../../src/usecases/shared-volume-seed.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fileSystem = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fileSystem.makeTempDirectoryScoped({
          prefix: "docker-git-shared-volume-seed-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const failOnCopyFile = (
  fileSystem: FileSystem.FileSystem,
  label: string
): FileSystem.FileSystem => ({
  ...fileSystem,
  copyFile: () => Effect.dieMessage(`${label}: unexpected copyFile`)
})

describe("stageBootstrapSnapshot", () => {
  it.effect("copies stable Codex auth files and skips transient broken tmp entries", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fileSystem = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)

        const projectDir = path.join(root, "project")
        const stagingDir = path.join(root, "staging")
        const projectCodexDir = path.join(projectDir, ".orch", "auth", "codex")
        const projectCodexLabelDir = path.join(projectCodexDir, "team-a")
        const projectClaudeDir = path.join(projectDir, ".orch", "auth", "claude", "default")
        const sharedCodexDir = path.join(root, ".docker-git", ".orch", "auth", "codex")
        const sharedCodexLabelDir = path.join(sharedCodexDir, "team-a")
        const envDir = path.join(projectDir, ".orch", "env")

        yield* _(fileSystem.makeDirectory(projectCodexDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(projectCodexLabelDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(projectClaudeDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedCodexDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedCodexLabelDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(envDir, { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(projectDir, "authorized_keys"), "ssh-ed25519 test\n"))
        yield* _(fileSystem.writeFileString(path.join(envDir, "global.env"), "GITHUB_TOKEN=test\n"))
        yield* _(fileSystem.writeFileString(path.join(envDir, "project.env"), "CODEX_SHARE_AUTH=1\n"))
        yield* _(fileSystem.writeFileString(path.join(projectCodexDir, "auth.json"), "{\"project\":true}\n"))
        yield* _(fileSystem.writeFileString(path.join(projectCodexDir, "config.toml"), "model = \"gpt-5.4\"\n"))
        yield* _(fileSystem.writeFileString(path.join(projectCodexLabelDir, "auth.json"), "{\"label\":\"team-a\"}\n"))
        yield* _(fileSystem.writeFileString(path.join(projectCodexLabelDir, "config.toml"), "model = \"gpt-5.4\"\n"))
        yield* _(fileSystem.writeFileString(path.join(projectClaudeDir, ".oauth-token"), "claude-token\n"))
        yield* _(fileSystem.writeFileString(path.join(sharedCodexDir, "auth.json"), "{\"shared\":true}\n"))
        yield* _(fileSystem.writeFileString(path.join(sharedCodexLabelDir, "auth.json"), "{\"shared\":\"team-a\"}\n"))

        yield* _(
          Effect.sync(() => {
            const brokenShimDir = path.join(sharedCodexDir, "tmp", "arg0", "codex-arg0broken")
            fs.mkdirSync(brokenShimDir, { recursive: true })
            fs.symlinkSync(
              "/usr/local/bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex/codex",
              path.join(brokenShimDir, "apply_patch")
            )
            fs.writeFileSync(path.join(brokenShimDir, ".lock"), "")
            fs.mkdirSync(path.join(sharedCodexDir, "log"), { recursive: true })
            fs.writeFileSync(path.join(sharedCodexDir, "log", "codex-login.log"), "transient log\n")
            fs.mkdirSync(path.join(sharedCodexDir, ".image"), { recursive: true })
            fs.writeFileSync(path.join(sharedCodexDir, ".image", "Dockerfile"), "FROM scratch\n")
          })
        )

        yield* _(
          stageBootstrapSnapshot(stagingDir, projectDir, {
            volumeName: "dg-test-home",
            authorizedKeysPath: path.join(projectDir, "authorized_keys"),
            envGlobalPath: path.join(projectDir, ".orch", "env", "global.env"),
            envProjectPath: path.join(projectDir, ".orch", "env", "project.env"),
            codexAuthPath: path.join(projectDir, ".orch", "auth", "codex"),
            codexSharedAuthPath: sharedCodexDir
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, failOnCopyFile(fileSystem, "stageBootstrapSnapshot"))
          )
        )

        expect(yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "codex", "auth.json")))).toBe(
          "{\"project\":true}\n"
        )
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "codex", "config.toml")))
        ).toBe("model = \"gpt-5.4\"\n")
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "codex", "team-a", "auth.json")))
        ).toBe("{\"label\":\"team-a\"}\n")
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "codex", "team-a", "config.toml")))
        ).toBe("model = \"gpt-5.4\"\n")
        expect(yield* _(fileSystem.readFileString(path.join(stagingDir, "shared-auth", "codex", "auth.json")))).toBe(
          "{\"shared\":true}\n"
        )
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "shared-auth", "codex", "team-a", "auth.json")))
        ).toBe("{\"shared\":\"team-a\"}\n")
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "claude", "default", ".oauth-token")))
        ).toBe("claude-token\n")

        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", "tmp")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", "log")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", ".image")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "project-auth", "codex", "tmp")))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
