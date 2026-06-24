import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { enableMcpAndroidProjectFiles } from "../../src/usecases/mcp-android.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-mcp-android-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeGlobalConfig = (root: string, path: Path.Path): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  enableMcpAndroid: false,
  gpu: "none",
  bunVersion: "1.3.11"
})

const makeProjectConfig = (
  outDir: string,
  enableMcpAndroid: boolean,
  path: Path.Path
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(outDir, ".docker-git"),
  authorizedKeysPath: path.join(outDir, "authorized_keys"),
  envGlobalPath: path.join(outDir, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(outDir, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(outDir, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  enableMcpAndroid,
  bunVersion: "1.3.11"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readEnableMcpAndroidFlag = (value: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const template = value.template
  if (!isRecord(template)) {
    return undefined
  }

  const flag = template.enableMcpAndroid
  return typeof flag === "boolean" ? flag : undefined
}

describe("enableMcpAndroidProjectFiles", () => {
  it.effect("enables Android MCP for an existing project without rewriting env files", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const withoutMcp = makeProjectConfig(outDir, false, path)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withoutMcp, {
            force: false,
            forceEnv: false
          })
        )

        const envProjectPath = path.join(outDir, ".orch/env/project.env")
        yield* _(fs.writeFileString(envProjectPath, "# custom env\nCUSTOM_KEY=1\n"))

        yield* _(enableMcpAndroidProjectFiles(outDir))

        const envAfter = yield* _(fs.readFileString(envProjectPath))
        expect(envAfter).toContain("CUSTOM_KEY=1")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).toContain("dg-test-android")
        expect(composeAfter).toContain('MCP_ANDROID_ENABLE: "1"')
        expect(composeAfter).toContain('DOCKER_GIT_ANDROID_PROJECT: "dg-test"')
        expect(composeAfter).toContain('DOCKER_GIT_ANDROID_CONTAINER_NAME: "dg-test-android"')
        expect(composeAfter).toContain("/dev/kvm")

        const dockerfileAfter = yield* _(fs.readFileString(path.join(outDir, "Dockerfile")))
        expect(dockerfileAfter).toContain("android-tools-adb")
        expect(dockerfileAfter).toContain(
          "cargo install --git https://github.com/ProverCoderAI/rust-android-connection --rev 7fd2c8f37fccc2b5fdb3ac53e1c55d168e79d09c --locked --bins --root /usr/local"
        )
        expect(dockerfileAfter).toContain("/usr/local/bin/android-connection --version")
        expect(dockerfileAfter).not.toContain(".docker-git-tools/android-connection")

        const configAfterText = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        const configAfter = yield* _(Effect.sync((): unknown => JSON.parse(configAfterText)))
        expect(readEnableMcpAndroidFlag(configAfter)).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
