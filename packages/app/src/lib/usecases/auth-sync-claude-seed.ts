import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import {
  hasClaudeCredentials,
  hasClaudeOauthAccount,
  hasNonEmptyFile,
  parseJsonRecord,
  resolvePathFromBase
} from "./auth-sync-helpers.js"
import { withFsPathContext } from "./runtime.js"

type ClaudeJsonSyncSpec = {
  readonly sourcePath: string
  readonly targetPath: string
  readonly hasRequiredData: (record: Parameters<typeof hasClaudeOauthAccount>[0]) => boolean
  readonly onWrite: (targetPath: string) => Effect.Effect<void, PlatformError>
  readonly seedLabel: string
  readonly updateLabel: string
}

const syncClaudeJsonFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  spec: ClaudeJsonSyncSpec
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceExists = yield* _(fs.exists(spec.sourcePath))
    if (!sourceExists) {
      return
    }

    const sourceInfo = yield* _(fs.stat(spec.sourcePath))
    if (sourceInfo.type !== "File") {
      return
    }

    const sourceText = yield* _(fs.readFileString(spec.sourcePath))
    const sourceJson = yield* _(parseJsonRecord(sourceText))
    if (!spec.hasRequiredData(sourceJson)) {
      return
    }

    const targetExists = yield* _(fs.exists(spec.targetPath))
    if (!targetExists) {
      yield* _(fs.makeDirectory(path.dirname(spec.targetPath), { recursive: true }))
      yield* _(fs.copyFile(spec.sourcePath, spec.targetPath))
      yield* _(spec.onWrite(spec.targetPath))
      yield* _(Effect.log(`Seeded ${spec.seedLabel} from ${spec.sourcePath} to ${spec.targetPath}`))
      return
    }

    const targetInfo = yield* _(fs.stat(spec.targetPath))
    if (targetInfo.type !== "File") {
      return
    }

    const targetText = yield* _(fs.readFileString(spec.targetPath), Effect.orElseSucceed(() => ""))
    const targetJson = yield* _(parseJsonRecord(targetText))
    if (!spec.hasRequiredData(targetJson)) {
      yield* _(fs.writeFileString(spec.targetPath, sourceText))
      yield* _(spec.onWrite(spec.targetPath))
      yield* _(Effect.log(`Updated ${spec.updateLabel} from ${spec.sourcePath} to ${spec.targetPath}`))
    }
  })

const syncClaudeHomeJson = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  syncClaudeJsonFile(fs, path, {
    sourcePath,
    targetPath,
    hasRequiredData: hasClaudeOauthAccount,
    onWrite: () => Effect.void,
    seedLabel: "Claude auth file",
    updateLabel: "Claude auth file"
  })

const syncClaudeCredentialsJson = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  syncClaudeJsonFile(fs, path, {
    sourcePath,
    targetPath,
    hasRequiredData: hasClaudeCredentials,
    onWrite: (pathToChmod) => fs.chmod(pathToChmod, 0o600).pipe(Effect.orElseSucceed(() => void 0)),
    seedLabel: "Claude credentials",
    updateLabel: "Claude credentials"
  })

// CHANGE: seed docker-git Claude auth store from host-level Claude files
// WHY: Claude Code (v2+) keeps OAuth session in ~/.claude.json and ~/.claude/.credentials.json
// QUOTE(ТЗ): "глобальная авторизация для клода ... должна сама везде настроиться"
// REF: user-request-2026-03-04-claude-global-auth-seed
// SOURCE: https://docs.anthropic.com/en/docs/claude-code/settings (section: \"Files and settings\", mentions ~/.claude.json)
// FORMAT THEOREM: ∀p: project(p) → (host_claude_auth_exists → project_claude_auth_seeded)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: never deletes existing auth data; only seeds missing/incomplete Claude auth files
// COMPLEXITY: O(1)
export const ensureClaudeAuthSeedFromHome = (
  baseDir: string,
  claudeAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const homeDir = (process.env["HOME"] ?? "").trim()
      if (homeDir.length === 0) {
        return
      }

      const sourceClaudeJson = path.join(homeDir, ".claude.json")
      const sourceCredentials = path.join(homeDir, ".claude", ".credentials.json")

      const claudeRoot = resolvePathFromBase(path, baseDir, claudeAuthPath)
      const targetAccountDir = path.join(claudeRoot, "default")
      const targetClaudeJson = path.join(targetAccountDir, ".claude.json")
      const targetOauthToken = path.join(targetAccountDir, ".oauth-token")
      const targetCredentials = path.join(targetAccountDir, ".credentials.json")
      const hasTargetOauthToken = yield* _(hasNonEmptyFile(fs, targetOauthToken))

      yield* _(fs.makeDirectory(targetAccountDir, { recursive: true }))
      yield* _(syncClaudeHomeJson(fs, path, sourceClaudeJson, targetClaudeJson))
      if (!hasTargetOauthToken) {
        yield* _(syncClaudeCredentialsJson(fs, path, sourceCredentials, targetCredentials))
      }
    })
  )
