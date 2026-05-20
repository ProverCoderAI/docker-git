import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { defaultTemplateConfig, type TemplateConfig } from "../../src/core/domain.js"
import { readProjectConfig } from "../../src/shell/config.js"
import { normalizeLegacyStateProjects } from "../../src/usecases/state-normalize.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-state-normalize-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeLegacyTemplate = (): TemplateConfig => ({
  ...defaultTemplateConfig,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "issue-327",
  containerName: "dg-state-normalize",
  serviceName: "dg-state-normalize",
  dockerGitPath: "./.docker-git",
  authorizedKeysPath: "./.docker-git/authorized_keys",
  envGlobalPath: "./.docker-git/.orch/env/global.env",
  envProjectPath: "./.orch/env/project.env",
  codexAuthPath: "./.docker-git/.orch/auth/codex",
  codexSharedAuthPath: "./.docker-git/.orch/auth/codex",
  grokAuthPath: "./.docker-git/.orch/auth/grok"
})

describe("normalizeLegacyStateProjects", () => {
  it.effect("normalizes legacy Grok auth paths to the global state auth root", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectDir = path.join(root, "project")
        const configPath = path.join(projectDir, "docker-git.json")

        yield* _(fs.makeDirectory(projectDir, { recursive: true }))
        yield* _(
          fs.writeFileString(
            configPath,
            `${JSON.stringify({ schemaVersion: 1, template: makeLegacyTemplate() }, null, 2)}\n`
          )
        )

        yield* _(normalizeLegacyStateProjects(root))

        const config = yield* _(readProjectConfig(projectDir))
        expect(config.template.codexAuthPath).toBe("./.orch/auth/codex")
        expect(config.template.codexSharedAuthPath).toBe("../.orch/auth/codex")
        expect(config.template.grokAuthPath).toBe("../.orch/auth/grok")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
