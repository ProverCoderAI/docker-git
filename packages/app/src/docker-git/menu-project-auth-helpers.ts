import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { hasFileAtPath, hasNonEmptyFile } from "./menu-auth-file-helpers.js"

export { hasFileAtPath, hasNonEmptyFile } from "./menu-auth-file-helpers.js"

type AccountCredentialSpec = {
  readonly apiKeyFileName: string
  readonly envFileName: string
  readonly envKeys: ReadonlyArray<string>
}

// PURITY: CORE
// INVARIANT: true iff `trimmed` assigns a non-empty value to one of `keys`
const hasNonEmptyKeyValueInLine = (trimmed: string, keys: ReadonlyArray<string>): boolean => {
  for (const key of keys) {
    const prefix = `${key}=`
    if (!trimmed.startsWith(prefix)) {
      continue
    }
    const value = trimmed.slice(prefix.length).replaceAll(/^['"]|['"]$/g, "").trim()
    if (value.length > 0) {
      return true
    }
  }
  return false
}

export const hasNonEmptyEnvValue = (
  fs: FileSystem.FileSystem,
  envFilePath: string,
  keys: ReadonlyArray<string>
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, envFilePath))
    if (!hasFile) {
      return false
    }
    const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      if (hasNonEmptyKeyValueInLine(trimmed, keys)) {
        return true
      }
    }
    return false
  })

export const hasApiKeyOrEnvCredentials = (
  fs: FileSystem.FileSystem,
  apiKeyPath: string,
  envFilePath: string,
  envKeys: ReadonlyArray<string>,
  fallback: Effect.Effect<boolean, PlatformError>
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyFile(fs, apiKeyPath).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }
      return hasNonEmptyEnvValue(fs, envFilePath, envKeys).pipe(
        Effect.flatMap((hasEnvValue) => hasEnvValue ? Effect.succeed(true) : fallback)
      )
    })
  )

export const hasAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string,
  spec: AccountCredentialSpec,
  fallback: Effect.Effect<boolean, PlatformError>
): Effect.Effect<boolean, PlatformError> =>
  hasApiKeyOrEnvCredentials(
    fs,
    `${accountPath}/${spec.apiKeyFileName}`,
    `${accountPath}/${spec.envFileName}`,
    spec.envKeys,
    fallback
  )
