import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

const volatileWriteRetryAttempts = 5

export const isNotFoundSystemError = (error: PlatformError): boolean =>
  error._tag === "SystemError" && error.reason === "NotFound"

const succeedNullOnNotFound = (error: PlatformError): Effect.Effect<null, PlatformError> =>
  isNotFoundSystemError(error)
    ? Effect.succeed(null)
    : Effect.fail(error)

export const statIfPresent = (
  fs: FileSystem.FileSystem,
  targetPath: string
): Effect.Effect<FileSystem.File.Info | null, PlatformError> =>
  fs.stat(targetPath).pipe(Effect.catchTag("SystemError", succeedNullOnNotFound))

export const readFileStringIfPresent = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<string | null, PlatformError> =>
  fs.readFileString(filePath).pipe(Effect.catchTag("SystemError", succeedNullOnNotFound))

const writeFileStringAttempt = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  targetPath: string,
  contents: string,
  attempt: number
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    yield* _(fs.makeDirectory(path.dirname(targetPath), { recursive: true }))
    yield* _(fs.writeFileString(targetPath, contents))
  }).pipe(
    Effect.catchTag("SystemError", (error) =>
      isNotFoundSystemError(error) && attempt + 1 < volatileWriteRetryAttempts
        ? fs.remove(targetPath, { force: true }).pipe(
          Effect.orElseSucceed(() => void 0),
          Effect.zipRight(writeFileStringAttempt(fs, path, targetPath, contents, attempt + 1))
        )
        : Effect.fail(error))
  )

export const writeFileStringEnsuringParent = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  targetPath: string,
  contents: string
): Effect.Effect<void, PlatformError> => writeFileStringAttempt(fs, path, targetPath, contents, 0)
