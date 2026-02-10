import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type FsPathContext = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly cwd: string
}

// CHANGE: provide a shared FileSystem/Path context for usecases
// WHY: avoid duplicated setup across shell workflows
// QUOTE(ТЗ): "минимальный корректный diff"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall run: ctx(run) -> fs,path,cwd
// PURITY: SHELL
// EFFECT: Effect<A, PlatformError, FileSystem | Path>
// INVARIANT: cwd is captured once per call
// COMPLEXITY: O(1)
export const withFsPathContext = <A, E, R>(
  run: (context: FsPathContext) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    return yield* _(run({ fs, path, cwd: process.cwd() }))
  })
