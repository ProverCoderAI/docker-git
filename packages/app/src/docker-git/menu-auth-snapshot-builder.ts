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

export type AuthAccountCountPaths = {
  readonly claudeAuthPath: string
  readonly codexAuthPath: string
  readonly geminiAuthPath: string
  readonly grokAuthPath: string
}

export const countAuthAccountEntries = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  authPaths: AuthAccountCountPaths
): Effect.Effect<AuthAccountCounts, PlatformError> =>
  pipe(
    Effect.all({
      claudeAuthEntries: countAuthCredentialAccounts(
        fs,
        path,
        authPaths.claudeAuthPath,
        hasClaudeAccountCredentials
      ),
      codexAuthEntries: countCodexCredentialAccounts(fs, path, authPaths.codexAuthPath),
      geminiAuthEntries: countAuthCredentialAccounts(
        fs,
        path,
        authPaths.geminiAuthPath,
        hasGeminiAccountCredentials
      ),
      grokAuthEntries: countAuthCredentialAccounts(
        fs,
        path,
        authPaths.grokAuthPath,
        hasGrokAccountCredentials
      )
    })
  )
