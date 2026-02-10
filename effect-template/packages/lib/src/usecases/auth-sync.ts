import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { withFsPathContext } from "./runtime.js"

type CopyDecision = "skip" | "copy"

const defaultEnvContents = "# docker-git env\n# KEY=value\n"
// CHANGE: enable web search tool in default Codex config (top-level)
// WHY: avoid deprecated legacy flags and keep config minimal
// QUOTE(ТЗ): "да убери легаси"
// REF: user-request-2026-02-05-remove-legacy-web-search
// SOURCE: n/a
// FORMAT THEOREM: ∀c: config(c) -> web_search(c)="live"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: default config stays deterministic
// COMPLEXITY: O(1)
const defaultCodexConfig = [
  "# docker-git codex config",
  "model = \"gpt-5.3-codex\"",
  "model_reasoning_effort = \"xhigh\"",
  "personality = \"pragmatic\"",
  "",
  "approval_policy = \"never\"",
  "sandbox_mode = \"danger-full-access\"",
  "web_search = \"live\"",
  "",
  "[features]",
  "web_search_request = true",
  "shell_snapshot = true",
  "collab = true",
  "apps = true",
  "shell_tool = true"
].join("\n")

const resolvePathFromBase = (path: Path.Path, baseDir: string, targetPath: string): string =>
  path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath)

const codexConfigMarker = "# docker-git codex config"

const normalizeConfigText = (text: string): string =>
  text
    .replaceAll("\r\n", "\n")
    .trim()

const shouldRewriteDockerGitCodexConfig = (existing: string): boolean => {
  const normalized = normalizeConfigText(existing)
  if (normalized.length === 0) {
    return true
  }
  if (!normalized.startsWith(codexConfigMarker)) {
    return false
  }
  return normalized !== normalizeConfigText(defaultCodexConfig)
}

const shouldCopyEnv = (sourceText: string, targetText: string): CopyDecision => {
  if (sourceText.trim().length === 0) {
    return "skip"
  }
  if (targetText.trim().length === 0) {
    return "copy"
  }
  if (targetText.trim() === defaultEnvContents.trim() && sourceText.trim() !== defaultEnvContents.trim()) {
    return "copy"
  }
  return "skip"
}

const copyFileIfNeeded = (
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const sourceExists = yield* _(fs.exists(sourcePath))
      if (!sourceExists) {
        return
      }
      const sourceInfo = yield* _(fs.stat(sourcePath))
      if (sourceInfo.type !== "File") {
        return
      }
      yield* _(fs.makeDirectory(path.dirname(targetPath), { recursive: true }))
      const targetExists = yield* _(fs.exists(targetPath))
      if (!targetExists) {
        yield* _(fs.copyFile(sourcePath, targetPath))
        yield* _(Effect.log(`Copied env file from ${sourcePath} to ${targetPath}`))
        return
      }
      const sourceText = yield* _(fs.readFileString(sourcePath))
      const targetText = yield* _(fs.readFileString(targetPath))
      if (shouldCopyEnv(sourceText, targetText) === "copy") {
        yield* _(fs.writeFileString(targetPath, sourceText))
        yield* _(Effect.log(`Synced env file from ${sourcePath} to ${targetPath}`))
      }
    })
  )

const copyDirRecursive = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourcePath: string,
  targetPath: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceInfo = yield* _(fs.stat(sourcePath))
    if (sourceInfo.type !== "Directory") {
      return
    }
    yield* _(fs.makeDirectory(targetPath, { recursive: true }))
    const entries = yield* _(fs.readDirectory(sourcePath))
    for (const entry of entries) {
      const sourceEntry = path.join(sourcePath, entry)
      const targetEntry = path.join(targetPath, entry)
      const entryInfo = yield* _(fs.stat(sourceEntry))
      if (entryInfo.type === "Directory") {
        yield* _(copyDirRecursive(fs, path, sourceEntry, targetEntry))
      } else if (entryInfo.type === "File") {
        yield* _(fs.copyFile(sourceEntry, targetEntry))
      }
    }
  })

type CodexFileCopySpec = {
  readonly sourceDir: string
  readonly targetDir: string
  readonly fileName: string
  readonly label: string
}

const copyCodexFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  spec: CodexFileCopySpec
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const sourceFile = path.join(spec.sourceDir, spec.fileName)
    const targetFile = path.join(spec.targetDir, spec.fileName)
    const sourceExists = yield* _(fs.exists(sourceFile))
    if (!sourceExists) {
      return
    }
    const targetExists = yield* _(fs.exists(targetFile))
    if (targetExists) {
      return
    }
    yield* _(fs.copyFile(sourceFile, targetFile))
    yield* _(Effect.log(`Copied Codex ${spec.label} from ${sourceFile} to ${targetFile}`))
  })

// CHANGE: ensure Codex config exists with full-access defaults
// WHY: enable all codex commands without extra prompts inside containers
// QUOTE(ТЗ): "сразу настраивал полностью весь доступ ко всем командам"
// REF: user-request-2026-01-30-codex-config
// SOURCE: n/a
// FORMAT THEOREM: forall p: missing(config(p)) -> config(p)=defaults
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: rewrites only docker-git-managed configs to keep defaults in sync
// COMPLEXITY: O(n) where n = |config|
export const ensureCodexConfigFile = (
  baseDir: string,
  codexAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const resolved = resolvePathFromBase(path, baseDir, codexAuthPath)
      const configPath = path.join(resolved, "config.toml")
      const exists = yield* _(fs.exists(configPath))
      if (exists) {
        const current = yield* _(fs.readFileString(configPath))
        if (!shouldRewriteDockerGitCodexConfig(current)) {
          return
        }
        yield* _(fs.writeFileString(configPath, defaultCodexConfig))
        yield* _(Effect.log(`Updated Codex config at ${configPath}`))
        return
      }
      yield* _(fs.makeDirectory(resolved, { recursive: true }))
      yield* _(fs.writeFileString(configPath, defaultCodexConfig))
      yield* _(Effect.log(`Created Codex config at ${configPath}`))
    })
  )

const copyDirIfEmpty = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  sourceDir: string,
  targetDir: string,
  label: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    if (sourceDir === targetDir) {
      return
    }
    const sourceExists = yield* _(fs.exists(sourceDir))
    if (!sourceExists) {
      return
    }
    const sourceInfo = yield* _(fs.stat(sourceDir))
    if (sourceInfo.type !== "Directory") {
      return
    }
    yield* _(fs.makeDirectory(targetDir, { recursive: true }))
    const targetEntries = yield* _(fs.readDirectory(targetDir))
    if (targetEntries.length > 0) {
      return
    }
    yield* _(copyDirRecursive(fs, path, sourceDir, targetDir))
    yield* _(Effect.log(`Copied ${label} from ${sourceDir} to ${targetDir}`))
  })

// CHANGE: sync shared auth artifacts into new project directory
// WHY: reuse global GH/Codex auth across containers automatically
// QUOTE(ТЗ): "автоматически всё копировали на наш контейнер? и gh тоже"
// REF: user-request-2026-01-29-auth-sync
// SOURCE: n/a
// FORMAT THEOREM: forall p: sync(p) -> env,codex_auth available(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: only copies when target is empty or placeholder
// COMPLEXITY: O(n) where n = |files|
type AuthPaths = {
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
}

export type AuthSyncSpec = {
  readonly sourceBase: string
  readonly targetBase: string
  readonly source: AuthPaths
  readonly target: AuthPaths
}

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

      yield* _(copyFileIfNeeded(sourceGlobal, targetGlobal))
      yield* _(copyFileIfNeeded(sourceProject, targetProject))
      yield* _(fs.makeDirectory(targetCodex, { recursive: true }))
      if (sourceCodex !== targetCodex) {
        const sourceExists = yield* _(fs.exists(sourceCodex))
        if (sourceExists) {
          const sourceInfo = yield* _(fs.stat(sourceCodex))
          if (sourceInfo.type === "Directory") {
            const targetExists = yield* _(fs.exists(targetCodex))
            if (!targetExists) {
              yield* _(fs.makeDirectory(targetCodex, { recursive: true }))
            }
            // NOTE: We intentionally do not copy auth.json.
            // ChatGPT refresh tokens are rotating; copying them into each project causes refresh_token_reused.
            yield* _(
              copyCodexFile(fs, path, {
                sourceDir: sourceCodex,
                targetDir: targetCodex,
                fileName: "config.toml",
                label: "config"
              })
            )
          }
        }
      }
    })
  )

// CHANGE: migrate legacy .orch layout into the new .docker-git/.orch location
// WHY: keep all shared auth/config files under .docker-git by default
// QUOTE(ТЗ): "по умолчанию все конфиги хранились вместе ... .docker-git"
// REF: user-request-2026-01-29-orch-layout
// SOURCE: n/a
// FORMAT THEOREM: forall s: legacy(s) -> migrated(s)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: never overwrites existing non-empty targets
// COMPLEXITY: O(n) where n = |files|
export const migrateLegacyOrchLayout = (
  baseDir: string,
  envGlobalPath: string,
  envProjectPath: string,
  codexAuthPath: string,
  ghAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const legacyRoot = path.resolve(baseDir, ".orch")
      const legacyExists = yield* _(fs.exists(legacyRoot))
      if (!legacyExists) {
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

      const resolvedEnvGlobal = resolvePathFromBase(path, baseDir, envGlobalPath)
      const resolvedEnvProject = resolvePathFromBase(path, baseDir, envProjectPath)
      const resolvedCodex = resolvePathFromBase(path, baseDir, codexAuthPath)
      const resolvedGh = resolvePathFromBase(path, baseDir, ghAuthPath)

      yield* _(copyFileIfNeeded(legacyEnvGlobal, resolvedEnvGlobal))
      yield* _(copyFileIfNeeded(legacyEnvProject, resolvedEnvProject))
      yield* _(copyDirIfEmpty(fs, path, legacyCodex, resolvedCodex, "Codex auth"))
      yield* _(copyDirIfEmpty(fs, path, legacyGh, resolvedGh, "GH auth"))
    })
  )
