import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { hasAccountCredentials, hasFileAtPath } from "./menu-project-auth-helpers.js"

// CHANGE: add Gemini CLI account credentials check for project auth
// WHY: enable Gemini CLI authentication verification at project level (API key or OAuth)
// QUOTE(ТЗ): "Добавь поддержку gemini CLI", "Типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment from skulidropek
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall accountPath: hasGeminiAccountCredentials(fs, accountPath) = boolean | PlatformError
// PURITY: SHELL
// EFFECT: Effect<boolean, PlatformError>
// INVARIANT: returns true only if valid API key or OAuth credentials exist
// COMPLEXITY: O(1)

const apiKeyFileName = ".api-key"
const envFileName = ".env"
const geminiCredentialsDir = ".gemini"
const geminiEnvApiKeyNames: ReadonlyArray<string> = ["GEMINI_API_KEY"]
const geminiCredentialSpec = {
  apiKeyFileName,
  envFileName,
  envKeys: geminiEnvApiKeyNames
}

// CHANGE: check for OAuth credentials in .gemini directory
// WHY: Gemini CLI stores OAuth tokens in ~/.gemini after successful OAuth flow
// QUOTE(ТЗ): "Типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment
// FORMAT THEOREM: hasOauthCredentials(fs, credentialsDir) -> boolean
// PURITY: SHELL
// INVARIANT: checks for existence of OAuth credential files
// COMPLEXITY: O(n) where n = number of possible credential files
const geminiOauthCredentialFiles: ReadonlyArray<string> = [
  "oauth_creds.json",
  "oauth-tokens.json",
  "credentials.json",
  "application_default_credentials.json"
]

const checkAnyFileExists = (
  fs: FileSystem.FileSystem,
  basePath: string,
  fileNames: ReadonlyArray<string>
): Effect.Effect<boolean, PlatformError> => {
  const [first, ...rest] = fileNames
  if (first === undefined) {
    return Effect.succeed(false)
  }
  return hasFileAtPath(fs, `${basePath}/${first}`).pipe(
    Effect.flatMap((exists) => exists ? Effect.succeed(true) : checkAnyFileExists(fs, basePath, rest))
  )
}

const hasOauthCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  checkAnyFileExists(fs, `${accountPath}/${geminiCredentialsDir}`, geminiOauthCredentialFiles)

export const hasGeminiAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasAccountCredentials(
    fs,
    accountPath,
    geminiCredentialSpec,
    hasOauthCredentials(fs, accountPath)
  )
