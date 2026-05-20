import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

type FilePredicate = (
  fs: FileSystem.FileSystem,
  filePath: string
) => Effect.Effect<boolean, PlatformError>

export const hasFileAtPath: FilePredicate = (fs, filePath) =>
  fs.stat(filePath).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false)
  )

export const hasNonEmptyFile: FilePredicate = (fs, filePath) =>
  hasFileAtPath(fs, filePath).pipe(
    Effect.flatMap((hasFile) => {
      if (!hasFile) {
        return Effect.succeed(false)
      }
      return fs.readFileString(filePath).pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((content) => content.trim().length > 0)
      )
    })
  )
