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
  it.effect("copies stable Codex and Grok auth files and skips transient entries", () =>
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
        const sharedGrokDir = path.join(root, ".docker-git", ".orch", "auth", "grok")
        const sharedGrokDefaultDir = path.join(sharedGrokDir, "default")
        const sharedGrokCredentialsDir = path.join(sharedGrokDefaultDir, ".grok")
        const sharedGrokLabelDir = path.join(sharedGrokDir, "team-a")
        const sharedGrokLabelCredentialsDir = path.join(sharedGrokLabelDir, ".grok")
        const envDir = path.join(projectDir, ".orch", "env")

        yield* _(fileSystem.makeDirectory(projectCodexDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(projectCodexLabelDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(projectClaudeDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedCodexDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedCodexLabelDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedGrokCredentialsDir, { recursive: true }))
        yield* _(fileSystem.makeDirectory(sharedGrokLabelCredentialsDir, { recursive: true }))
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
        yield* _(fileSystem.writeFileString(path.join(sharedGrokDefaultDir, ".api-key"), "xai-default\n"))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokDefaultDir, ".env"), "GROK_DEPLOYMENT_KEY=xai-env\n"))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokCredentialsDir, "auth.json"), "{\"oauth\":\"default\"}\n"))
        yield* _(
          fileSystem.writeFileString(path.join(sharedGrokCredentialsDir, "user-settings.json"), "{\"apiKey\":\"xai-default\"}\n")
        )
        yield* _(fileSystem.writeFileString(path.join(sharedGrokLabelDir, ".api-key"), "xai-team-a\n"))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokLabelCredentialsDir, "auth.json"), "{\"oauth\":\"team-a\"}\n"))

        const brokenShimDir = path.join(sharedCodexDir, "tmp", "arg0", "codex-arg0broken")
        yield* _(fileSystem.makeDirectory(brokenShimDir, { recursive: true }))
        yield* _(
          fileSystem.symlink(
            "/usr/local/bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex/codex",
            path.join(brokenShimDir, "apply_patch")
          )
        )
        yield* _(fileSystem.writeFileString(path.join(brokenShimDir, ".lock"), ""))
        yield* _(fileSystem.makeDirectory(path.join(sharedCodexDir, "log"), { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(sharedCodexDir, "log", "codex-login.log"), "transient log\n"))
        yield* _(fileSystem.makeDirectory(path.join(sharedCodexDir, ".image"), { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(sharedCodexDir, ".image", "Dockerfile"), "FROM scratch\n"))
        yield* _(fileSystem.makeDirectory(path.join(sharedGrokDir, "tmp"), { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokDir, "tmp", "session.lock"), "lock\n"))
        yield* _(fileSystem.makeDirectory(path.join(sharedGrokDir, "log"), { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokDir, "log", "grok-login.log"), "transient log\n"))
        yield* _(fileSystem.makeDirectory(path.join(sharedGrokDir, ".image"), { recursive: true }))
        yield* _(fileSystem.writeFileString(path.join(sharedGrokDir, ".image", "Dockerfile"), "FROM scratch\n"))

        yield* _(
          stageBootstrapSnapshot(stagingDir, projectDir, {
            volumeName: "dg-test-home",
            authorizedKeysPath: path.join(projectDir, "authorized_keys"),
            envGlobalPath: path.join(projectDir, ".orch", "env", "global.env"),
            envProjectPath: path.join(projectDir, ".orch", "env", "project.env"),
            codexAuthPath: path.join(projectDir, ".orch", "auth", "codex"),
            codexSharedAuthPath: sharedCodexDir,
            grokAuthPath: "./.docker-git/.orch/auth/grok"
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
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "grok", "default", ".api-key")))
        ).toBe("xai-default\n")
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "grok", "default", ".env")))
        ).toBe("GROK_DEPLOYMENT_KEY=xai-env\n")
        expect(
          yield* _(
            fileSystem.readFileString(path.join(stagingDir, "project-auth", "grok", "default", ".grok", "auth.json"))
          )
        ).toBe("{\"oauth\":\"default\"}\n")
        expect(
          yield* _(fileSystem.readFileString(path.join(stagingDir, "project-auth", "grok", "team-a", ".api-key")))
        ).toBe("xai-team-a\n")
        expect(
          yield* _(
            fileSystem.readFileString(path.join(stagingDir, "project-auth", "grok", "team-a", ".grok", "auth.json"))
          )
        ).toBe("{\"oauth\":\"team-a\"}\n")

        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", "tmp")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", "log")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "shared-auth", "codex", ".image")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "project-auth", "codex", "tmp")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "project-auth", "grok", "tmp")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "project-auth", "grok", "log")))).toBe(false)
        expect(yield* _(fileSystem.exists(path.join(stagingDir, "project-auth", "grok", ".image")))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
