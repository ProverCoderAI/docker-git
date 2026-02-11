import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

const copyDirRecursive = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceInfo = yield* _(fs.stat(sourcePath))
    if (sourceInfo.type !== "Directory") {
      return
    }
    yield* _(fs.makeDirectory(targetPath, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourcePath))
    for (const entry of entries) {
      const sourceEntry = path.join(sourcePath, entry)
      const targetEntry = path.join(targetPath, entry)
      const entryInfo = yield* _(fs.stat(sourceEntry))
      if (entryInfo.type === "Directory") {
        yield* _(copyDirRecursive(fs, path, sourceEntry, targetEntry))
      } else if (entryInfo.type === "File") {
        yield* _(fs.copyFile(sourceEntry, targetEntry))
      }
    }
  })

type CodexFileCopySpec = {
  readonly sourceDir: string
  readonly targetDir: string
  readonly fileName: string
  readonly label: string
}

export const copyCodexFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  spec: CodexFileCopySpec
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceFile = path.join(spec.sourceDir, spec.fileName)
    const targetFile = path.join(spec.targetDir, spec.fileName)
    const sourceExists = yield* _(fs.exists(sourceFile))
    if (!sourceExists) {
      return
    }
    const targetExists = yield* _(fs.exists(targetFile))
    if (targetExists) {
      return
    }
    yield* _(fs.copyFile(sourceFile, targetFile))
    yield* _(Effect.log(`Copied Codex ${spec.label} from ${sourceFile} to ${targetFile}`))
  })

export const copyDirIfEmpty = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceDir: string,
  targetDir: string,
  label: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    if (sourceDir === targetDir) {
      return
    }
    const sourceExists = yield* _(fs.exists(sourceDir))
    if (!sourceExists) {
      return
    }
    const sourceInfo = yield* _(fs.stat(sourceDir))
    if (sourceInfo.type !== "Directory") {
      return
    }
    yield* _(fs.makeDirectory(targetDir, { recursive: true }))
    const targetEntries = yield* _(fs.readDirectory(targetDir))
    if (targetEntries.length > 0) {
      return
    }
    yield* _(copyDirRecursive(fs, path, sourceDir, targetDir))
    yield* _(Effect.log(`Copied ${label} from ${sourceDir} to ${targetDir}`))
  })
