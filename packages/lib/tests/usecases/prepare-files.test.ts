import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(use: (tempDir: string) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const tempDir = yield* _(
        Effect.acquireRelease(
          Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "docker-git-force-env-"))),
          (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true }))
        )
      )
      return yield* _(use(tempDir))
    })
  )

const makeGlobalConfig = (root: string): TemplateConfig => ({
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

const makeProjectConfig = (outDir: string, enableMcpPlaywright: boolean): TemplateConfig => ({
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

describe("prepareProjectFiles", () => {
  it.effect("force-env refresh rewrites managed templates", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root)
        const withoutMcp = makeProjectConfig(outDir, false)
        const withMcp = makeProjectConfig(outDir, true)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withoutMcp, {
            force: false,
            forceEnv: false
          })
        )

        const composeBefore = yield* _(
          Effect.sync(() => fs.readFileSync(path.join(outDir, "docker-compose.yml"), "utf8"))
        )
        expect(composeBefore).not.toContain("dg-test-browser")

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withMcp, {
            force: false,
            forceEnv: true
          })
        )

        const composeAfter = yield* _(
          Effect.sync(() => fs.readFileSync(path.join(outDir, "docker-compose.yml"), "utf8"))
        )
        const configAfter = yield* _(
          Effect.sync(() => JSON.parse(fs.readFileSync(path.join(outDir, "docker-git.json"), "utf8")))
        )

        expect(composeAfter).toContain("dg-test-browser")
        expect(composeAfter).toContain('MCP_PLAYWRIGHT_ENABLE: "1"')
        expect(configAfter.template.enableMcpPlaywright).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
