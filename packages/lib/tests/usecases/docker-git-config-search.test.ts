import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { findDockerGitConfigPaths } from "../../src/usecases/docker-git-config-search.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-config-search-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const writeFileWithParents = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  filePath: string
) =>
  Effect.gen(function*(_) {
    const parent = path.dirname(filePath)
    yield* _(fs.makeDirectory(parent, { recursive: true }))
    yield* _(fs.writeFileString(filePath, "{}\n"))
  })

describe("findDockerGitConfigPaths", () => {
  it.effect("skips metadata and shared docker-git cache directories", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const includedMain = path.join(root, "org/repo-a/docker-git.json")
        const includedNested = path.join(root, "org/repo-b/nested/docker-git.json")
        const ignoredGit = path.join(root, "org/repo-a/.git/docker-git.json")
        const ignoredOrch = path.join(root, "org/repo-a/.orch/docker-git.json")
        const ignoredRootCache = path.join(root, ".cache/packages/pnpm/store/v10/index/docker-git.json")
        const ignoredDockerGit = path.join(root, ".docker-git/.cache/git-mirrors/docker-git.json")

        yield* _(writeFileWithParents(fs, path, includedMain))
        yield* _(writeFileWithParents(fs, path, includedNested))
        yield* _(writeFileWithParents(fs, path, ignoredGit))
        yield* _(writeFileWithParents(fs, path, ignoredOrch))
        yield* _(writeFileWithParents(fs, path, ignoredRootCache))
        yield* _(writeFileWithParents(fs, path, ignoredDockerGit))

        const found = yield* _(findDockerGitConfigPaths(fs, path, root))
        expect([...found].sort()).toEqual([includedMain, includedNested].sort())
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("skips broken symlinks without failing search", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const includedMain = path.join(root, "org/repo-a/docker-git.json")
        const brokenLink = path.join(root, "org/repo-a/broken-link")
        const missingTarget = path.join(root, "org/repo-a/missing-target")

        yield* _(writeFileWithParents(fs, path, includedMain))
        yield* _(fs.symlink(missingTarget, brokenLink))

        const found = yield* _(findDockerGitConfigPaths(fs, path, root))
        expect(found).toEqual([includedMain])
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
