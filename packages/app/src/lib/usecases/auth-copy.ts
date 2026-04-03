/* jscpd:ignore-start */
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

const shouldSkipCopiedDir = (entry: string): boolean => entry === "tmp"

const isNotFoundSystemError = (error: PlatformError): boolean =>
  error._tag === "SystemError" && error.reason === "NotFound"

const statIfPresent = (
  fs: FileSystem.FileSystem,
  targetPath: string
) =>
  fs.stat(targetPath).pipe(
    Effect.catchTag("SystemError", (error) =>
      isNotFoundSystemError(error)
        ? Effect.succeed(null)
        : Effect.fail(error))
  )

const copyDirRecursive = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceInfo = yield* _(statIfPresent(fs, sourcePath))
    if (sourceInfo === null) {
      return
    }
    if (sourceInfo.type !== "Directory") {
      return
    }
    yield* _(fs.makeDirectory(targetPath, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourcePath))
    for (const entry of entries) {
      const sourceEntry = path.join(sourcePath, entry)
      const targetEntry = path.join(targetPath, entry)
      if (shouldSkipCopiedDir(entry)) {
        continue
      }
      const entryInfo = yield* _(statIfPresent(fs, sourceEntry))
      if (entryInfo === null) {
        continue
      }
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

const sourceDirReady = (
  fs: FileSystem.FileSystem,
  sourceDir: string,
  targetDir: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    if (sourceDir === targetDir) {
      return false
    }
    const sourceExists = yield* _(fs.exists(sourceDir))
    if (!sourceExists) {
      return false
    }
    const sourceInfo = yield* _(statIfPresent(fs, sourceDir))
    if (sourceInfo === null) {
      return false
    }
    return sourceInfo.type === "Directory"
  })

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
    const sourceText = yield* _(fs.readFileString(sourceFile))
    const targetExists = yield* _(fs.exists(targetFile))
    if (targetExists) {
      const targetText = yield* _(fs.readFileString(targetFile))
      if (targetText === sourceText) {
        return
      }
      yield* _(fs.writeFileString(targetFile, sourceText))
      yield* _(Effect.log(`Synced Codex ${spec.label} from ${sourceFile} to ${targetFile}`))
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
    const ready = yield* _(sourceDirReady(fs, sourceDir, targetDir))
    if (!ready) {
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

const copyMissingRecursive = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceInfo = yield* _(statIfPresent(fs, sourcePath))
    if (sourceInfo === null) {
      return
    }
    if (sourceInfo.type === "Directory") {
      yield* _(fs.makeDirectory(targetPath, { recursive: true }))
      const entries = yield* _(fs.readDirectory(sourcePath))
      for (const entry of entries) {
        yield* _(copyMissingRecursive(fs, path, path.join(sourcePath, entry), path.join(targetPath, entry)))
      }
      return
    }

    if (sourceInfo.type !== "File") {
      return
    }

    const targetExists = yield* _(fs.exists(targetPath))
    if (targetExists) {
      return
    }

    yield* _(fs.makeDirectory(path.dirname(targetPath), { recursive: true }))
    yield* _(fs.copyFile(sourcePath, targetPath))
  })

export const copyDirMissingEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceDir: string,
  targetDir: string,
  label: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const ready = yield* _(sourceDirReady(fs, sourceDir, targetDir))
    if (!ready) {
      return
    }

    yield* _(copyMissingRecursive(fs, path, sourceDir, targetDir))
    yield* _(Effect.log(`Seeded missing ${label} entries from ${sourceDir} to ${targetDir}`))
  })
/* jscpd:ignore-end */
