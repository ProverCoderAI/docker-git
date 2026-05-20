import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

type AccountCredentialSpec = {
  readonly apiKeyFileName: string
  readonly envFileName: string
  readonly envKeys: ReadonlyArray<string>
}

export const hasFileAtPath = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  fs.stat(filePath).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.catchAll(() => Effect.succeed(false))
  )

export const hasNonEmptyFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  fs.readFileString(filePath).pipe(
    Effect.map((content) => content.trim().length > 0),
    Effect.catchAll(() => Effect.succeed(false))
  )

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
