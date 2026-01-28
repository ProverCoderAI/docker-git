import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

type ResolvedContext = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly resolved: string
}

export const resolveBaseDir = (
  baseDir: string
): Effect.Effect<ResolvedContext, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolved = path.resolve(baseDir)

    return { fs, path, resolved }
  })
