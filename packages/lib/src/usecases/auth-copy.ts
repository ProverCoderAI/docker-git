import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { readFileStringIfPresent, statIfPresent, writeFileStringEnsuringParent } from "./volatile-files.js"

const shouldSkipCopiedDir = (entry: string): boolean => entry === "tmp"

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
        const sourceText = yield* _(readFileStringIfPresent(fs, sourceEntry))
        if (sourceText === null) {
          continue
        }
        yield* _(writeFileStringEnsuringParent(fs, path, targetEntry, sourceText))
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
    const sourceText = yield* _(readFileStringIfPresent(fs, sourceFile))
    if (sourceText === null) {
      return
    }
    yield* _(fs.makeDirectory(spec.targetDir, { recursive: true }))
    const targetText = yield* _(readFileStringIfPresent(fs, targetFile))
    if (targetText === sourceText) {
      return
    }
    yield* _(writeFileStringEnsuringParent(fs, path, targetFile, sourceText))
    yield* _(
      Effect.log(
        `${targetText === null ? "Copied" : "Synced"} Codex ${spec.label} from ${sourceFile} to ${targetFile}`
      )
    )
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

    const targetInfo = yield* _(statIfPresent(fs, targetPath))
    if (targetInfo !== null) {
      return
    }

    const sourceText = yield* _(readFileStringIfPresent(fs, sourcePath))
    if (sourceText === null) {
      return
    }
    yield* _(writeFileStringEnsuringParent(fs, path, targetPath, sourceText))
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
