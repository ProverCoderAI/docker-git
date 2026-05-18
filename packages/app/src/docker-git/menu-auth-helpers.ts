import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

export const countAuthAccountDirectories = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }
    const entries = yield* _(fs.readDirectory(root))
    let count = 0
    for (const entry of entries) {
      if (entry === ".image") {
        continue
      }
      const fullPath = path.join(root, entry)
      const info = yield* _(fs.stat(fullPath))
      if (info.type === "Directory") {
        count += 1
      }
    }
    return count
  })
