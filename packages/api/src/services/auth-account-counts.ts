import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { hasGrokAuthJsonCredentialText, hasGrokUserSettingsCredentialText } from "@effect-template/lib/usecases/auth-grok-credential-text"

type HasCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
) => Effect.Effect<boolean, PlatformError>

const ignoredAuthAccountEntries: ReadonlySet<string> = new Set([".image"])
const grokEnvApiKeyNames: ReadonlyArray<string> = ["GROK_DEPLOYMENT_KEY", "GROK_API_KEY", "XAI_API_KEY"]

const hasFileAtPath = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })

const hasNonEmptyFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, filePath))
    if (!hasFile) {
      return false
    }
    const content = yield* _(fs.readFileString(filePath), Effect.orElseSucceed(() => ""))
    return content.trim().length > 0
  })

const hasApiKeyInEnvFile = (
  fs: FileSystem.FileSystem,
  envFilePath: string,
  key: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, envFilePath))
    if (!hasFile) {
      return false
    }
    const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
    const prefix = `${key}=`
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith(prefix)) {
        continue
      }
      const value = trimmed.slice(prefix.length).replaceAll(/^['"]|['"]$/g, "").trim()
      if (value.length > 0) {
        return true
      }
    }
    return false
  })

const hasAnyFile = (
  fs: FileSystem.FileSystem,
  basePath: string,
  fileNames: ReadonlyArray<string>
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    for (const fileName of fileNames) {
      const hasFile = yield* _(hasFileAtPath(fs, `${basePath}/${fileName}`))
      if (hasFile) {
        return true
      }
    }
    return false
  })

const hasLegacyClaudeAuthFile = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(accountPath))
    if (!exists) {
      return false
    }
    const entries = yield* _(fs.readDirectory(accountPath))
    for (const entry of entries) {
      if (!entry.startsWith(".claude") || !entry.endsWith(".json")) {
        continue
      }
      const isFile = yield* _(hasFileAtPath(fs, `${accountPath}/${entry}`))
      if (isFile) {
        return true
      }
    }
    return false
  })

export const hasClaudeAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasFileAtPath(fs, `${accountPath}/.credentials.json`).pipe(
    Effect.flatMap((hasCredentialsFile) => {
      if (hasCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/.claude/.credentials.json`)
    }),
    Effect.flatMap((hasNestedCredentialsFile) => {
      if (hasNestedCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/.config.json`)
    }),
    Effect.flatMap((hasConfig) => {
      if (hasConfig) {
        return Effect.succeed(true)
      }
      return hasNonEmptyFile(fs, `${accountPath}/.oauth-token`).pipe(
        Effect.flatMap((hasOauthToken) => hasOauthToken ? Effect.succeed(true) : hasLegacyClaudeAuthFile(fs, accountPath))
      )
    })
  )

export const hasGeminiAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyFile(fs, `${accountPath}/.api-key`).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }
      return hasApiKeyInEnvFile(fs, `${accountPath}/.env`, "GEMINI_API_KEY").pipe(
        Effect.flatMap((hasEnvApiKey) =>
          hasEnvApiKey
            ? Effect.succeed(true)
            : hasAnyFile(fs, `${accountPath}/.gemini`, [
              "oauth_creds.json",
              "oauth-tokens.json",
              "credentials.json",
              "application_default_credentials.json"
            ])
        )
      )
    })
  )

const hasGrokUserSettingsCredentials = (
  fs: FileSystem.FileSystem,
  settingsPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, settingsPath))
    if (!hasFile) {
      return false
    }
    const settingsText = yield* _(fs.readFileString(settingsPath), Effect.orElseSucceed(() => ""))
    return hasGrokUserSettingsCredentialText(settingsText)
  })

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

const hasGrokEnvApiKey = (
  fs: FileSystem.FileSystem,
  envFilePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    for (const key of grokEnvApiKeyNames) {
      const hasApiKey = yield* _(hasApiKeyInEnvFile(fs, envFilePath, key))
      if (hasApiKey) {
        return true
      }
    }
    return false
  })

export const hasGrokAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyFile(fs, `${accountPath}/.api-key`).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }
      return hasGrokEnvApiKey(fs, `${accountPath}/.env`).pipe(
        Effect.flatMap((hasEnvApiKey) => {
          if (hasEnvApiKey) {
            return Effect.succeed(true)
          }
          return hasGrokAuthJsonCredentials(fs, `${accountPath}/.grok/auth.json`).pipe(
            Effect.flatMap((hasAuthJson) =>
              hasAuthJson
                ? Effect.succeed(true)
                : hasGrokUserSettingsCredentials(fs, `${accountPath}/.grok/user-settings.json`)
            )
          )
        })
      )
    })
  )

export const hasCodexAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyFile(fs, `${accountPath}/auth.json`)

export const countCodexCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }

    let count = yield* _(hasCodexAccountCredentials(fs, root), Effect.map((connected) => connected ? 1 : 0))
    const entries = yield* _(fs.readDirectory(root))
    for (const entry of entries) {
      if (ignoredAuthAccountEntries.has(entry)) {
        continue
      }

      const accountPath = path.join(root, entry)
      const info = yield* _(fs.stat(accountPath))
      if (info.type !== "Directory") {
        continue
      }

      const connected = yield* _(hasCodexAccountCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (connected) {
        count += 1
      }
    }
    return count
  })

export const countAuthCredentialAccounts = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  hasCredentials: HasCredentials
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }

    const entries = yield* _(fs.readDirectory(root))
    let count = 0
    for (const entry of entries) {
      if (ignoredAuthAccountEntries.has(entry)) {
        continue
      }

      const accountPath = path.join(root, entry)
      const info = yield* _(fs.stat(accountPath))
      if (info.type !== "Directory") {
        continue
      }

      const connected = yield* _(hasCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (connected) {
        count += 1
      }
    }
    return count
  })
