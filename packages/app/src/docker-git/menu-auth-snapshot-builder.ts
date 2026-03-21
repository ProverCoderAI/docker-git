import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { AppError } from "@effect-template/lib/usecases/errors"
import { countAuthAccountDirectories } from "./menu-auth-helpers.js"

export type AuthAccountCounts = {
  readonly claudeAuthEntries: number
  readonly geminiAuthEntries: number
}

export const countAuthAccountEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  claudeAuthPath: string,
  geminiAuthPath: string
): Effect.Effect<AuthAccountCounts, AppError> =>
  pipe(
    Effect.all({
      claudeAuthEntries: countAuthAccountDirectories(fs, path, claudeAuthPath),
      geminiAuthEntries: countAuthAccountDirectories(fs, path, geminiAuthPath)
    })
  )
