import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

const workspaceMarkers: ReadonlyArray<string> = ["bunfig.toml", ".git"]

const hasWorkspaceMarker = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directory: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    for (const marker of workspaceMarkers) {
      if (yield* _(fs.exists(path.join(directory, marker)))) {
        return true
      }
    }
    return false
  })

const resolveWorkspaceRootFrom = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  startDir: string,
  currentDir: string
): Effect.Effect<string, PlatformError> =>
  Effect.gen(function*(_) {
    if (yield* _(hasWorkspaceMarker(fs, path, currentDir))) {
      return currentDir
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) {
      return startDir
    }

    return yield* _(resolveWorkspaceRootFrom(fs, path, startDir, parent))
  })

export const resolveWorkspaceRoot = (
  startDir: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedStartDir = path.resolve(startDir)
    return yield* _(resolveWorkspaceRootFrom(fs, path, resolvedStartDir, resolvedStartDir))
  })
