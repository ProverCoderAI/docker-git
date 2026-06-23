import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { resolveWorkspaceRoot } from "./workspace-root.js"

const androidConnectionToolRelativePath = ".docker-git-tools/android-connection"

const ensureParentDir = (
  path: Path.Path,
  fs: FileSystem.FileSystem,
  filePath: string
) => fs.makeDirectory(path.dirname(filePath), { recursive: true })

const resolveFileUrlPath = (fileUrl: string): string => {
  const url = new URL(fileUrl)
  return url.protocol === "file:" ? decodeURIComponent(url.pathname) : fileUrl
}

const shouldSkipAndroidConnectionEntry = (entry: string): boolean => entry === "target" || entry === ".git"

const copyTextFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const contents = yield* _(fs.readFileString(sourcePath))
    yield* _(ensureParentDir(path, fs, targetPath))
    yield* _(fs.writeFileString(targetPath, contents))
  })

const copyTextDirectoryEntry = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const info = yield* _(fs.stat(sourcePath))
    if (info.type === "Directory") {
      yield* _(copyTextDirectory(fs, path, sourcePath, targetPath))
      return
    }
    if (info.type === "File") {
      yield* _(copyTextFile(fs, path, sourcePath, targetPath))
    }
  })

const copyTextDirectory = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    yield* _(fs.makeDirectory(targetPath, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourcePath))
    for (const entry of entries) {
      if (shouldSkipAndroidConnectionEntry(entry)) {
        continue
      }
      yield* _(
        copyTextDirectoryEntry(
          fs,
          path,
          path.join(sourcePath, entry),
          path.join(targetPath, entry)
        )
      )
    }
  })

const androidConnectionSourceCandidates = (
  path: Path.Path,
  workspaceRoot: string
): ReadonlyArray<string> => [
  path.join(workspaceRoot, "crates", "android-connection"),
  path.join(
    path.dirname(resolveFileUrlPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "crates",
    "android-connection"
  )
]

const firstExistingDirectory = (
  fs: FileSystem.FileSystem,
  candidates: ReadonlyArray<string>
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    for (const candidate of candidates) {
      const isExists = yield* _(fs.exists(candidate))
      if (!isExists) {
        continue
      }
      const info = yield* _(fs.stat(candidate))
      if (info.type === "Directory") {
        return candidate
      }
    }
    return null
  })

// CHANGE: provision the first-party Android MCP Rust source into the Docker build context
// WHY: the generated Dockerfile installs android-connection with cargo install --path --locked
// QUOTE(ТЗ): "Сперва нужно отдельно реализовать сам модуль и доказать что он работает"
// REF: issue-436
// SOURCE: n/a
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: enabled Android MCP builds from the same audited crate source as local tests
// COMPLEXITY: O(n) where n = |android_connection_source_files|
export const provisionDockerGitAndroidConnectionSource = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  baseDir: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const workspaceRoot = yield* _(resolveWorkspaceRoot(process.cwd()))
    const sourcePath = yield* _(
      firstExistingDirectory(
        fs,
        androidConnectionSourceCandidates(path, workspaceRoot)
      )
    )
    if (sourcePath === null) {
      yield* _(
        Effect.dieMessage(
          "android-connection source not found; expected crates/android-connection in the docker-git workspace"
        )
      )
      return
    }

    yield* _(
      copyTextDirectory(
        fs,
        path,
        sourcePath,
        path.join(baseDir, androidConnectionToolRelativePath)
      )
    )
  })
