import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { hasFileAtPath } from "./menu-project-auth-helpers.js"

const oauthTokenFileName = ".oauth-token"
const legacyConfigFileName = ".config.json"
const credentialsFileName = ".credentials.json"
const nestedCredentialsFileName = ".claude/.credentials.json"

const hasNonEmptyOauthToken = (
  fs: FileSystem.FileSystem,
  tokenPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, tokenPath))
    if (!hasFile) {
      return false
    }
    const tokenValue = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
    return tokenValue.trim().length > 0
  })

const hasLegacyClaudeAuthFile = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
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
  hasFileAtPath(fs, `${accountPath}/${credentialsFileName}`).pipe(
    Effect.flatMap((hasCredentialsFile) => {
      if (hasCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/${nestedCredentialsFileName}`)
    }),
    Effect.flatMap((hasNestedCredentialsFile) => {
      if (hasNestedCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/${legacyConfigFileName}`)
    }),
    Effect.flatMap((hasConfig) => {
      if (hasConfig) {
        return Effect.succeed(true)
      }
      return hasNonEmptyOauthToken(fs, `${accountPath}/${oauthTokenFileName}`).pipe(
        Effect.flatMap((hasOauthToken) => {
          if (hasOauthToken) {
            return Effect.succeed(true)
          }
          return hasLegacyClaudeAuthFile(fs, accountPath)
        })
      )
    })
  )
