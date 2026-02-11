import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import type { FileExistsError } from "../../shell/errors.js"
import { writeProjectFiles } from "../../shell/files.js"
import { ensureCodexConfigFile, migrateLegacyOrchLayout, syncAuthArtifacts } from "../auth-sync.js"
import { findAuthorizedKeysSource, resolveAuthorizedKeysPath } from "../path-helpers.js"
import { withFsPathContext } from "../runtime.js"
import { resolvePathFromBase } from "./paths.js"

type ExistingFileState = "exists" | "missing"

const ensureFileReady = (
  fs: FileSystem.FileSystem,
  resolved: string,
  onDirectoryMessage: (resolvedPath: string, backupPath: string) => string
): Effect.Effect<ExistingFileState, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(resolved))
    if (!exists) {
      return "missing"
    }

    const info = yield* _(fs.stat(resolved))
    if (info.type === "Directory") {
      const backupPath = `${resolved}.bak-${Date.now()}`
      yield* _(fs.rename(resolved, backupPath))
      yield* _(Effect.logWarning(onDirectoryMessage(resolved, backupPath)))
      return "missing"
    }

    return "exists"
  })

const ensureAuthorizedKeys = (
  baseDir: string,
  authorizedKeysPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const resolved = resolveAuthorizedKeysPath(path, baseDir, authorizedKeysPath)
      const state = yield* _(
        ensureFileReady(
          fs,
          resolved,
          (resolvedPath, backupPath) =>
            `Authorized keys was a directory, moved to ${backupPath}. Creating a file at ${resolvedPath}.`
        )
      )
      if (state === "exists") {
        return
      }

      const source = yield* _(findAuthorizedKeysSource(fs, path, process.cwd()))
      if (source === null) {
        yield* _(
          Effect.logError(
            `Authorized keys not found. Create ${resolved} with your public key to enable SSH.`
          )
        )
        return
      }

      yield* _(fs.makeDirectory(path.dirname(resolved), { recursive: true }))
      yield* _(fs.copyFile(source, resolved))
      yield* _(Effect.log(`Authorized keys copied from ${source} to ${resolved}`))
    })
  )

const defaultGlobalEnvContents = "# docker-git env\n# KEY=value\n"

const defaultProjectEnvContents = [
  "# docker-git project env defaults",
  "CODEX_SHARE_AUTH=1",
  "CODEX_AUTO_UPDATE=1",
  "DOCKER_GIT_ZSH_AUTOSUGGEST=1",
  "DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE=fg=8,italic",
  "DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY=history completion",
  "MCP_PLAYWRIGHT_ISOLATED=1",
  ""
].join("\n")

const ensureEnvFile = (
  baseDir: string,
  envPath: string,
  defaultContents: string,
  overwrite: boolean = false
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const resolved = resolvePathFromBase(path, baseDir, envPath)
      const state = yield* _(
        ensureFileReady(
          fs,
          resolved,
          (_resolvedPath, backupPath) => `Env file was a directory, moved to ${backupPath}.`
        )
      )
      if (state === "exists" && !overwrite) {
        return
      }

      yield* _(fs.makeDirectory(path.dirname(resolved), { recursive: true }))
      yield* _(fs.writeFileString(resolved, defaultContents))
    })
  )

export type PrepareProjectFilesError = FileExistsError | PlatformError

export const prepareProjectFiles = (
  resolvedOutDir: string,
  baseDir: string,
  globalConfig: CreateCommand["config"],
  projectConfig: CreateCommand["config"],
  force: boolean,
  forceEnv: boolean
): Effect.Effect<ReadonlyArray<string>, PrepareProjectFilesError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const envOnlyRefresh = forceEnv && !force
    const createdFiles = yield* _(writeProjectFiles(resolvedOutDir, projectConfig, force, envOnlyRefresh))
    yield* _(ensureAuthorizedKeys(resolvedOutDir, projectConfig.authorizedKeysPath))
    yield* _(ensureEnvFile(resolvedOutDir, projectConfig.envGlobalPath, defaultGlobalEnvContents))
    yield* _(
      ensureEnvFile(
        resolvedOutDir,
        projectConfig.envProjectPath,
        defaultProjectEnvContents,
        envOnlyRefresh
      )
    )
    yield* _(ensureCodexConfigFile(baseDir, globalConfig.codexAuthPath))
    yield* _(
      syncAuthArtifacts({
        sourceBase: baseDir,
        targetBase: resolvedOutDir,
        source: {
          envGlobalPath: globalConfig.envGlobalPath,
          envProjectPath: globalConfig.envProjectPath,
          codexAuthPath: globalConfig.codexAuthPath
        },
        target: {
          envGlobalPath: projectConfig.envGlobalPath,
          envProjectPath: projectConfig.envProjectPath,
          codexAuthPath: projectConfig.codexAuthPath
        }
      })
    )
    // Ensure per-project config stays in sync even when `.orch/auth/codex` already exists.
    yield* _(ensureCodexConfigFile(resolvedOutDir, projectConfig.codexAuthPath))
    return createdFiles
  })

export const migrateProjectOrchLayout = (
  baseDir: string,
  globalConfig: CreateCommand["config"],
  resolveRootPath: (value: string) => string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(
    baseDir,
    globalConfig.envGlobalPath,
    globalConfig.envProjectPath,
    globalConfig.codexAuthPath,
    resolveRootPath(".docker-git/.orch/auth/gh")
  )
