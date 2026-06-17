import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { copyCodexFile, copyDirIfEmpty, copyDirMissingEntries } from "./auth-copy.js"
import {
  type AuthSyncSpec,
  defaultCodexConfig,
  isGithubTokenKey,
  type LegacyOrchPaths,
  resolvePathFromBase,
  shouldCopyEnv,
  shouldRewriteDockerGitCodexConfig,
  skipCodexConfigPermissionDenied
} from "./auth-sync-helpers.js"
import { parseEnvEntries, removeEnvKey, upsertEnvKey } from "./env-file.js"
import { withFsPathContext } from "./runtime.js"
import { readFileStringIfPresent, statIfPresent, writeFileStringEnsuringParent } from "./volatile-files.js"

export { ensureClaudeAuthSeedFromHome } from "./auth-sync-claude-seed.js"

// CHANGE: synchronize GitHub auth keys between env files
// WHY: avoid stale per-project tokens that cause clone auth failures after token rotation
// QUOTE(ТЗ): n/a
// REF: user-request-2026-02-11-clone-invalid-token
// SOURCE: n/a
// FORMAT THEOREM: ∀k ∈ github_token_keys: source(k)=v → merged(k)=v
// PURITY: CORE
// INVARIANT: non-auth keys in target are preserved
// COMPLEXITY: O(n) where n = |env entries|
export const syncGithubAuthKeys = (sourceText: string, targetText: string): string => {
  const sourceTokenEntries = parseEnvEntries(sourceText).filter((entry) => isGithubTokenKey(entry.key))
  if (sourceTokenEntries.length === 0) {
    return targetText
  }

  const targetTokenKeys = parseEnvEntries(targetText)
    .filter((entry) => isGithubTokenKey(entry.key))
    .map((entry) => entry.key)

  let next = targetText
  for (const key of targetTokenKeys) {
    next = removeEnvKey(next, key)
  }
  for (const entry of sourceTokenEntries) {
    next = upsertEnvKey(next, entry.key, entry.value)
  }

  return next
}

const syncGithubTokenKeysInFile = (
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const sourceInfo = yield* _(statIfPresent(fs, sourcePath))
      if (sourceInfo === null) {
        return
      }
      const targetInfo = yield* _(statIfPresent(fs, targetPath))
      if (targetInfo === null) {
        return
      }
      if (sourceInfo.type !== "File" || targetInfo.type !== "File") {
        return
      }

      const sourceText = yield* _(readFileStringIfPresent(fs, sourcePath))
      if (sourceText === null) {
        return
      }
      const targetText = yield* _(fs.readFileString(targetPath))
      const mergedText = syncGithubAuthKeys(sourceText, targetText)
      if (mergedText !== targetText) {
        yield* _(writeFileStringEnsuringParent(fs, path, targetPath, mergedText))
        yield* _(Effect.log(`Synced GitHub auth keys from ${sourcePath} to ${targetPath}`))
      }
    })
  )

const copyFileIfNeeded = (
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const sourceInfo = yield* _(statIfPresent(fs, sourcePath))
      if (sourceInfo === null || sourceInfo.type !== "File") {
        return
      }
      const sourceText = yield* _(readFileStringIfPresent(fs, sourcePath))
      if (sourceText === null) {
        return
      }
      const targetText = yield* _(readFileStringIfPresent(fs, targetPath))
      if (targetText === null) {
        yield* _(writeFileStringEnsuringParent(fs, path, targetPath, sourceText))
        yield* _(Effect.log(`Copied env file from ${sourcePath} to ${targetPath}`))
        return
      }
      if (shouldCopyEnv(sourceText, targetText) === "copy") {
        yield* _(writeFileStringEnsuringParent(fs, path, targetPath, sourceText))
        yield* _(Effect.log(`Synced env file from ${sourcePath} to ${targetPath}`))
      }
    })
  )

// CHANGE: ensure Codex config exists with full-access defaults
// WHY: enable all codex commands without extra prompts inside containers
// QUOTE(ТЗ): "сразу настраивал полностью весь доступ ко всем командам"
// REF: user-request-2026-01-30-codex-config
// SOURCE: n/a
// FORMAT THEOREM: forall p: writable(config(p)) -> config(p)=defaults; permission_denied(config(p)) -> warning_logged
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: rewrites only docker-git-managed configs to keep defaults in sync, permission-denied writes are skipped
// COMPLEXITY: O(n) where n = |config|
export const ensureCodexConfigFile = (
  baseDir: string,
  codexAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const resolved = resolvePathFromBase(path, baseDir, codexAuthPath)
      const configPath = path.join(resolved, "config.toml")
      const writeConfig = Effect.gen(function*(__) {
        const isExists = yield* __(fs.exists(configPath))
        if (isExists) {
          const current = yield* __(fs.readFileString(configPath))
          if (!shouldRewriteDockerGitCodexConfig(current)) {
            return
          }
          yield* __(writeFileStringEnsuringParent(fs, path, configPath, defaultCodexConfig))
          yield* __(Effect.log(`Updated Codex config at ${configPath}`))
          return
        }
        yield* __(writeFileStringEnsuringParent(fs, path, configPath, defaultCodexConfig))
        yield* __(Effect.log(`Created Codex config at ${configPath}`))
      })
      yield* _(
        writeConfig.pipe(
          Effect.matchEffect({
            onFailure: (error) => skipCodexConfigPermissionDenied(configPath, error),
            onSuccess: () => Effect.void
          })
        )
      )
    })
  )

export const syncAuthArtifacts = (
  spec: AuthSyncSpec
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const sourceGlobal = resolvePathFromBase(path, spec.sourceBase, spec.source.envGlobalPath)
      const targetGlobal = resolvePathFromBase(path, spec.targetBase, spec.target.envGlobalPath)
      const sourceProject = resolvePathFromBase(path, spec.sourceBase, spec.source.envProjectPath)
      const targetProject = resolvePathFromBase(path, spec.targetBase, spec.target.envProjectPath)
      const sourceCodex = resolvePathFromBase(path, spec.sourceBase, spec.source.codexAuthPath)
      const targetCodex = resolvePathFromBase(path, spec.targetBase, spec.target.codexAuthPath)
      const sourceClaude = resolvePathFromBase(path, spec.sourceBase, spec.source.claudeAuthPath)
      const targetClaude = resolvePathFromBase(path, spec.targetBase, spec.target.claudeAuthPath)

      yield* _(copyFileIfNeeded(sourceGlobal, targetGlobal))
      yield* _(syncGithubTokenKeysInFile(sourceGlobal, targetGlobal))
      yield* _(copyFileIfNeeded(sourceProject, targetProject))
      yield* _(
        copyCodexFile(fs, path, {
          sourceDir: sourceCodex,
          targetDir: targetCodex,
          fileName: "auth.json",
          label: "auth"
        })
      )
      if (sourceCodex !== targetCodex) {
        yield* _(
          copyCodexFile(fs, path, {
            sourceDir: sourceCodex,
            targetDir: targetCodex,
            fileName: "config.toml",
            label: "config"
          })
        )
      }
      yield* _(copyDirMissingEntries(fs, path, sourceClaude, targetClaude, "Claude auth bootstrap"))
    })
  )

export const migrateLegacyOrchLayout = (
  baseDir: string,
  paths: LegacyOrchPaths
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const legacyRoot = path.resolve(baseDir, ".orch")
      const isLegacyExists = yield* _(fs.exists(legacyRoot))
      if (!isLegacyExists) {
        return
      }
      const legacyInfo = yield* _(fs.stat(legacyRoot))
      if (legacyInfo.type !== "Directory") {
        return
      }

      const legacyEnvGlobal = path.join(legacyRoot, "env", "global.env")
      const legacyEnvProject = path.join(legacyRoot, "env", "project.env")
      const legacyCodex = path.join(legacyRoot, "auth", "codex")
      const legacyGh = path.join(legacyRoot, "auth", "gh")
      const legacyClaude = path.join(legacyRoot, "auth", "claude")
      const legacyGemini = path.join(legacyRoot, "auth", "gemini")
      const legacyGrok = path.join(legacyRoot, "auth", "grok")

      const resolvedEnvGlobal = resolvePathFromBase(path, baseDir, paths.envGlobalPath)
      const resolvedEnvProject = resolvePathFromBase(path, baseDir, paths.envProjectPath)
      const resolvedCodex = resolvePathFromBase(path, baseDir, paths.codexAuthPath)
      const resolvedGh = resolvePathFromBase(path, baseDir, paths.ghAuthPath)
      const resolvedClaude = resolvePathFromBase(path, baseDir, paths.claudeAuthPath)

      yield* _(copyFileIfNeeded(legacyEnvGlobal, resolvedEnvGlobal))
      yield* _(copyFileIfNeeded(legacyEnvProject, resolvedEnvProject))
      yield* _(copyDirIfEmpty(fs, path, legacyCodex, resolvedCodex, "Codex auth"))
      yield* _(copyDirIfEmpty(fs, path, legacyGh, resolvedGh, "GH auth"))
      yield* _(copyDirIfEmpty(fs, path, legacyClaude, resolvedClaude, "Claude auth"))
      if (paths.geminiAuthPath !== undefined) {
        const resolvedGemini = resolvePathFromBase(path, baseDir, paths.geminiAuthPath)
        yield* _(copyDirIfEmpty(fs, path, legacyGemini, resolvedGemini, "Gemini auth"))
      }
      if (paths.grokAuthPath !== undefined) {
        const resolvedGrok = resolvePathFromBase(path, baseDir, paths.grokAuthPath)
        yield* _(copyDirIfEmpty(fs, path, legacyGrok, resolvedGrok, "Grok auth"))
      }
    })
  )
