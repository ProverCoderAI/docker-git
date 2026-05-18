import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { countAuthAccountDirectories } from "./menu-auth-helpers.js"

export type AuthAccountCounts = {
  readonly claudeAuthEntries: number
  readonly geminiAuthEntries: number
  readonly grokAuthEntries: number
}

export const countAuthAccountEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  claudeAuthPath: string,
  geminiAuthPath: string,
  grokAuthPath: string
): Effect.Effect<AuthAccountCounts, PlatformError> =>
  pipe(
    Effect.all({
      claudeAuthEntries: countAuthAccountDirectories(fs, path, claudeAuthPath),
      geminiAuthEntries: countAuthAccountDirectories(fs, path, geminiAuthPath),
      grokAuthEntries: countAuthAccountDirectories(fs, path, grokAuthPath)
    })
  )
