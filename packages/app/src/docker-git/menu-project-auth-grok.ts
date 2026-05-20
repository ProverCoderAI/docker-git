import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import {
  hasGrokAuthJsonCredentialText,
  hasGrokUserSettingsCredentialText
} from "./menu-project-auth-grok-credential-text.js"
import { hasAccountCredentials, hasFileAtPath } from "./menu-project-auth-helpers.js"

const grokEnvApiKeyNames: ReadonlyArray<string> = ["GROK_DEPLOYMENT_KEY", "GROK_API_KEY", "XAI_API_KEY"]
const grokApiKeyFileName = ".api-key"
const grokEnvFileName = ".env"
const grokCredentialSpec = {
  apiKeyFileName: grokApiKeyFileName,
  envFileName: grokEnvFileName,
  envKeys: grokEnvApiKeyNames
}

const hasGrokAuthJsonCredentials = (
  fs: FileSystem.FileSystem,
  authJsonPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, authJsonPath))
    if (!hasFile) {
      return false
    }
    const authJsonText = yield* _(fs.readFileString(authJsonPath), Effect.orElseSucceed(() => ""))
    return hasGrokAuthJsonCredentialText(authJsonText)
  })

const hasGrokUserSettingsCredentials = (
  fs: FileSystem.FileSystem,
  userSettingsPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, userSettingsPath))
    if (!hasFile) {
      return false
    }
    const settingsText = yield* _(fs.readFileString(userSettingsPath), Effect.orElseSucceed(() => ""))
    return hasGrokUserSettingsCredentialText(settingsText)
  })

export const hasGrokAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasAccountCredentials(
    fs,
    accountPath,
    grokCredentialSpec,
    hasGrokAuthJsonCredentials(fs, `${accountPath}/.grok/auth.json`).pipe(
      Effect.flatMap((hasAuthJson) =>
        hasAuthJson
          ? Effect.succeed(true)
          : hasGrokUserSettingsCredentials(fs, `${accountPath}/.grok/user-settings.json`)
      )
    )
  )
