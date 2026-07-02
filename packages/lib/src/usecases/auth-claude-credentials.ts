import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import {
  claudeOauthTokenFileMode,
  claudeOauthTokenPath,
  formatClaudeOauthTokenFile
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { Effect } from "effect"

import { isRegularFile } from "./auth-helpers.js"
import { readFileStringIfPresent, writeFileStringEnsuringParent } from "./volatile-files.js"

export type ClaudeAuthMethod = "none" | "oauth-token" | "claude-ai-session"

const claudeConfigFileName = ".claude.json"
const claudeCredentialsFileName = ".credentials.json"
const claudeCredentialsDirName = ".claude"

export const claudeConfigPath = (accountPath: string): string => `${accountPath}/${claudeConfigFileName}`
export const claudeCredentialsPath = (accountPath: string): string => `${accountPath}/${claudeCredentialsFileName}`
export const claudeNestedCredentialsPath = (accountPath: string): string =>
  `${accountPath}/${claudeCredentialsDirName}/${claudeCredentialsFileName}`

// CHANGE: persist Claude OAuth tokens through a restricted temporary file and atomic rename
// WHY: the final token path must never receive secret bytes before 0600 permissions are established
// QUOTE(ТЗ): "Исправь CI/CD и все правки от Rabbit Coder."
// REF: issue-439/pr-440
// SOURCE: n/a
// FORMAT THEOREM: forall token, path: write(secret, final(path)) only by rename(temp0600, final(path))
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError>
// INVARIANT: final .oauth-token is regular replacement content with mode 0600 after success
// COMPLEXITY: O(|token|)
export const persistClaudeOauthToken = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string,
  token: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const tokenPath = claudeOauthTokenPath(accountPath)
    const tempDir = yield* _(fs.makeTempDirectory({ directory: accountPath, prefix: ".oauth-token-write-" }))
    const tempPath = path.join(tempDir, ".oauth-token")
    const cleanupTempDir = fs.remove(tempDir, { recursive: true, force: true }).pipe(
      Effect.orElseSucceed(() => void 0)
    )
    yield* _(
      Effect.gen(function*(_) {
        yield* _(fs.writeFileString(tempPath, formatClaudeOauthTokenFile(token), { mode: claudeOauthTokenFileMode }))
        yield* _(fs.chmod(tempPath, claudeOauthTokenFileMode))
        yield* _(fs.rename(tempPath, tokenPath))
        yield* _(fs.chmod(tokenPath, claudeOauthTokenFileMode))
      }).pipe(Effect.ensuring(cleanupTempDir))
    )
  })

const syncClaudeCredentialsFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    // Keep both Claude credential layouts equivalent without exposing session bytes outside the auth directory.
    const nestedPath = claudeNestedCredentialsPath(accountPath)
    const rootPath = claudeCredentialsPath(accountPath)
    const isNestedExists = yield* _(isRegularFile(fs, nestedPath))
    if (isNestedExists) {
      const nestedText = yield* _(readFileStringIfPresent(fs, nestedPath))
      if (nestedText !== null) {
        yield* _(writeFileStringEnsuringParent(fs, path, rootPath, nestedText))
        yield* _(fs.chmod(rootPath, 0o600), Effect.orElseSucceed(() => void 0))
      }
      return
    }

    const isRootExists = yield* _(isRegularFile(fs, rootPath))
    if (isRootExists) {
      const rootText = yield* _(readFileStringIfPresent(fs, rootPath))
      if (rootText === null) {
        return
      }
      yield* _(writeFileStringEnsuringParent(fs, path, nestedPath, rootText))
      yield* _(fs.chmod(nestedPath, 0o600), Effect.orElseSucceed(() => void 0))
    }
  })

const clearClaudeSessionCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    // OAuth token auth wins over session files; stale session files would make status/probes ambiguous.
    yield* _(fs.remove(claudeCredentialsPath(accountPath), { force: true }))
    yield* _(fs.remove(claudeNestedCredentialsPath(accountPath), { force: true }))
  })

const readNonEmptyClaudeFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  readFileStringIfPresent(fs, filePath).pipe(
    Effect.map((text) => text !== null && text.trim().length > 0)
  )

export const readOauthToken = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const tokenPath = claudeOauthTokenPath(accountPath)
    const hasToken = yield* _(isRegularFile(fs, tokenPath))
    if (!hasToken) {
      return null
    }

    const tokenText = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
    const token = tokenText.trim()
    return token.length > 0 ? token : null
  })

export const readClaudeAuthMethod = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<ClaudeAuthMethod, PlatformError> =>
  Effect.gen(function*(_) {
    const oauthToken = yield* _(readOauthToken(fs, accountPath))
    if (oauthToken !== null) {
      return "oauth-token"
    }

    const hasRootCredentials = yield* _(readNonEmptyClaudeFile(fs, claudeCredentialsPath(accountPath)))
    if (hasRootCredentials) {
      return "claude-ai-session"
    }

    const hasNestedCredentials = yield* _(readNonEmptyClaudeFile(fs, claudeNestedCredentialsPath(accountPath)))
    return hasNestedCredentials ? "claude-ai-session" : "none"
  })

export const normalizeAndResolveClaudeAuthMethod = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  accountPath: string
): Effect.Effect<ClaudeAuthMethod, PlatformError> =>
  Effect.gen(function*(_) {
    // The normalizing variant is used by login/status flows that are allowed to repair legacy Claude layouts.
    const oauthToken = yield* _(readOauthToken(fs, accountPath))
    if (oauthToken !== null) {
      yield* _(clearClaudeSessionCredentials(fs, accountPath))
      return "oauth-token"
    }

    yield* _(syncClaudeCredentialsFile(fs, path, accountPath))
    return yield* _(readClaudeAuthMethod(fs, accountPath))
  })
