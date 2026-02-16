import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { ensureStateGitignore } from "../../src/usecases/state-repo/gitignore.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-state-gitignore-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

describe("ensureStateGitignore", () => {
  it.effect("creates managed .gitignore with repository mirror cache ignored", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)

        yield* _(ensureStateGitignore(fs, path, root))

        const gitignore = yield* _(fs.readFileString(path.join(root, ".gitignore")))
        expect(gitignore).toContain("# docker-git state repository")
        expect(gitignore).toContain(".cache/git-mirrors/")
        expect(gitignore).toContain("**/.orch/auth/codex/models_cache.json")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("appends missing cache ignore pattern for managed files", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const gitignorePath = path.join(root, ".gitignore")
        const existing = [
          "# docker-git state repository",
          "# NOTE: this repo intentionally tracks EVERYTHING under the state dir, including .orch/env and .orch/auth.",
          "# Keep the remote private; treat it as sensitive infrastructure state.",
          "",
          "custom-ignore/",
          ""
        ].join("\n")

        yield* _(fs.writeFileString(gitignorePath, existing))
        yield* _(ensureStateGitignore(fs, path, root))

        const gitignore = yield* _(fs.readFileString(gitignorePath))
        expect(gitignore).toContain("custom-ignore/")
        expect(gitignore).toContain("# Shared git mirrors cache (do not commit)")
        expect(gitignore).toContain(".cache/git-mirrors/")
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
