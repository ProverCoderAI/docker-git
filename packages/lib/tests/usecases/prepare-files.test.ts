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

        const composeBefore = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
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
