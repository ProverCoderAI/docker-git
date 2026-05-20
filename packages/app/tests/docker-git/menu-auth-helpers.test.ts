/* jscpd:ignore-start */
import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type * as Scope from "effect/Scope"

import { countAuthCredentialAccounts, countCodexCredentialAccounts } from "../../src/docker-git/menu-auth-helpers.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, FileSystem.FileSystem | Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-helpers-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const hasMarkerCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  fs.readFileString(`${accountPath}/.token`).pipe(
    Effect.map((content) => content.trim().length > 0)
  )

describe("menu auth helpers", () => {
  it.effect("counts root credentials and skips broken directory entries", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        yield* _(fs.makeDirectory(path.join(root, "work"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(root, ".token"), "root-token\n"))
        yield* _(fs.writeFileString(path.join(root, "work", ".token"), "work-token\n"))
        yield* _(fs.symlink(path.join(root, "missing-account"), path.join(root, "broken")))

        const count = yield* _(countAuthCredentialAccounts(fs, path, root, hasMarkerCredentials))

        expect(count).toBe(2)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("counts root and labeled Codex credentials", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        yield* _(fs.makeDirectory(path.join(root, "work"), { recursive: true }))
        yield* _(fs.writeFileString(path.join(root, "auth.json"), "{}\n"))
        yield* _(fs.writeFileString(path.join(root, "work", "auth.json"), "{}\n"))
        yield* _(fs.symlink(path.join(root, "missing-account"), path.join(root, "broken")))

        const count = yield* _(countCodexCredentialAccounts(fs, path, root))

        expect(count).toBe(2)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
/* jscpd:ignore-end */
