import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-force-env-"
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
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  enableMcpPlaywright: false,
  pnpmVersion: "10.27.0"
})

const makeProjectConfig = (
  outDir: string,
  enableMcpPlaywright: boolean,
  path: Path.Path
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(outDir, ".docker-git"),
  authorizedKeysPath: path.join(outDir, "authorized_keys"),
  envGlobalPath: path.join(outDir, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(outDir, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(outDir, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  enableMcpPlaywright,
  pnpmVersion: "10.27.0"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readEnableMcpPlaywrightFlag = (value: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const template = value.template
  if (!isRecord(template)) {
    return undefined
  }

  const flag = template.enableMcpPlaywright
  return typeof flag === "boolean" ? flag : undefined
}

describe("prepareProjectFiles", () => {
  it.effect("force-env refresh rewrites managed templates", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const withoutMcp = makeProjectConfig(outDir, false, path)
        const withMcp = makeProjectConfig(outDir, true, path)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withoutMcp, {
            force: false,
            forceEnv: false
          })
        )

        const dockerfile = yield* _(fs.readFileString(path.join(outDir, "Dockerfile")))
        const entrypoint = yield* _(fs.readFileString(path.join(outDir, "entrypoint.sh")))
        const composeBefore = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(dockerfile).toContain("docker-compose-v2")
        expect(entrypoint).toContain('DOCKER_GIT_HOME="/home/dev/.docker-git"')
        expect(entrypoint).toContain('SOURCE_SHARED_AUTH="/home/dev/.codex-shared/auth.json"')
        expect(entrypoint).toContain('OPENCODE_DATA_DIR="/home/dev/.local/share/opencode"')
        expect(entrypoint).toContain('OPENCODE_SHARED_HOME="/home/dev/.codex-shared/opencode"')
        expect(entrypoint).toContain('OPENCODE_CONFIG_DIR="/home/dev/.config/opencode"')
        expect(entrypoint).toContain('"plugin": ["oh-my-opencode"]')
        expect(composeBefore).toContain(":/home/dev/.docker-git")
        expect(composeBefore).not.toContain("dg-test-browser")

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withMcp, {
            force: false,
            forceEnv: true
          })
        )

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        const configAfterText = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        const configAfter = yield* _(Effect.sync((): unknown => JSON.parse(configAfterText)))

        expect(composeAfter).toContain("dg-test-browser")
        expect(composeAfter).toContain('MCP_PLAYWRIGHT_ENABLE: "1"')
        expect(readEnableMcpPlaywrightFlag(configAfter)).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
