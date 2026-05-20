import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import { countAuthCredentialAccounts, countCodexCredentialAccounts } from "./menu-auth-helpers.js"
import { hasClaudeAccountCredentials } from "./menu-project-auth-claude.js"
import { hasGeminiAccountCredentials } from "./menu-project-auth-gemini.js"
import { hasGrokAccountCredentials } from "./menu-project-auth-grok.js"

export type AuthAccountCounts = {
  readonly claudeAuthEntries: number
  readonly codexAuthEntries: number
  readonly geminiAuthEntries: number
  readonly grokAuthEntries: number
}

export const countAuthAccountEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  claudeAuthPath: string,
  codexAuthPath: string,
  geminiAuthPath: string,
  grokAuthPath: string
): Effect.Effect<AuthAccountCounts, PlatformError> =>
  pipe(
    Effect.all({
      claudeAuthEntries: countAuthCredentialAccounts(fs, path, claudeAuthPath, hasClaudeAccountCredentials),
      codexAuthEntries: countCodexCredentialAccounts(fs, path, codexAuthPath),
      geminiAuthEntries: countAuthCredentialAccounts(fs, path, geminiAuthPath, hasGeminiAccountCredentials),
      grokAuthEntries: countAuthCredentialAccounts(fs, path, grokAuthPath, hasGrokAccountCredentials)
    })
  )
