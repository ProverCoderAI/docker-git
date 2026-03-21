import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import type { FileExistsError } from "../../shell/errors.js"
import { writeProjectFiles } from "../../shell/files.js"
import {
  ensureClaudeAuthSeedFromHome,
  ensureCodexConfigFile,
  migrateLegacyOrchLayout,
  syncAuthArtifacts
} from "../auth-sync.js"
import {
  defaultProjectsRoot,
  findAuthorizedKeysSource,
  findExistingPath,
  findSshPrivateKey,
  resolveAuthorizedKeysPath
} from "../path-helpers.js"
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

const appendKeyIfMissing = (
  fs: FileSystem.FileSystem,
  resolved: string,
  source: string,
  desiredContents: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const currentContents = yield* _(fs.readFileString(resolved))
    const currentLines = currentContents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (currentLines.includes(desiredContents)) {
      return
    }

    const normalizedCurrent = currentContents.trimEnd()
    const nextContents = normalizedCurrent.length === 0
      ? `${desiredContents}\n`
      : `${normalizedCurrent}\n${desiredContents}\n`

    yield* _(fs.writeFileString(resolved, nextContents))
    yield* _(Effect.log(`Authorized keys appended from ${source} to ${resolved}`))
  })

const resolveAuthorizedKeysSource = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const sshPrivateKey = yield* _(findSshPrivateKey(fs, path, cwd))
    const matchingPublicKey = sshPrivateKey === null ? null : yield* _(findExistingPath(fs, `${sshPrivateKey}.pub`))
    return matchingPublicKey === null
      ? yield* _(findAuthorizedKeysSource(fs, path, cwd))
      : matchingPublicKey
  })

const ensureAuthorizedKeys = (
  baseDir: string,
  authorizedKeysPath: string,
  preferredSource: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const resolved = resolveAuthorizedKeysPath(path, baseDir, authorizedKeysPath)
      const managedDefaultAuthorizedKeys = path.join(defaultProjectsRoot(process.cwd()), "authorized_keys")
      const state = yield* _(
        ensureFileReady(
          fs,
          resolved,
          (resolvedPath, backupPath) =>
            `Authorized keys was a directory, moved to ${backupPath}. Creating a file at ${resolvedPath}.`
        )
      )

      if (state === "exists" && resolved !== managedDefaultAuthorizedKeys) {
        return
      }

      const preferred = resolvePathFromBase(path, baseDir, preferredSource)
      const preferredExists = yield* _(fs.exists(preferred))
      const preferredManagedSource = preferredExists && preferred !== resolved ? preferred : null
      const source = preferredManagedSource === null
        ? yield* _(resolveAuthorizedKeysSource(fs, path, process.cwd()))
        : preferredManagedSource
      if (source === null) {
        if (state === "missing") {
          yield* _(fs.makeDirectory(path.dirname(resolved), { recursive: true }))
          yield* _(fs.writeFileString(resolved, ""))
        }
        yield* _(
          Effect.logError(
            `Authorized keys not found. Create ${resolved} with your public key to enable SSH.`
          )
        )
        return
      }

      const desiredContents = (yield* _(fs.readFileString(source))).trim()
      if (desiredContents.length === 0) {
        yield* _(Effect.logWarning(`Authorized keys source ${source} is empty. Skipping SSH key sync.`))
        return
      }

      if (state === "exists") {
        if (resolved === managedDefaultAuthorizedKeys) {
          yield* _(appendKeyIfMissing(fs, resolved, source, desiredContents))
        }
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
type PrepareProjectFilesOptions = {
  readonly force: boolean
  readonly forceEnv: boolean
}

export const prepareProjectFiles = (
  resolvedOutDir: string,
  baseDir: string,
  globalConfig: CreateCommand["config"],
  projectConfig: CreateCommand["config"],
  options: PrepareProjectFilesOptions
): Effect.Effect<ReadonlyArray<string>, PrepareProjectFilesError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const rewriteManagedFiles = options.force || options.forceEnv
    const envOnlyRefresh = options.forceEnv && !options.force
    const createdFiles = yield* _(
      writeProjectFiles(resolvedOutDir, projectConfig, rewriteManagedFiles)
    )
    yield* _(ensureAuthorizedKeys(resolvedOutDir, projectConfig.authorizedKeysPath, globalConfig.authorizedKeysPath))
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
    const globalClaudeAuthPath = path.join(path.dirname(globalConfig.codexAuthPath), "claude")
    yield* _(ensureClaudeAuthSeedFromHome(baseDir, globalClaudeAuthPath))
    yield* _(
      syncAuthArtifacts({
        sourceBase: baseDir,
        targetBase: resolvedOutDir,
        source: {
          envGlobalPath: globalConfig.envGlobalPath,
          envProjectPath: globalConfig.envProjectPath,
          codexAuthPath: globalConfig.codexAuthPath,
          claudeAuthPath: globalClaudeAuthPath
        },
        target: {
          envGlobalPath: projectConfig.envGlobalPath,
          envProjectPath: projectConfig.envProjectPath,
          codexAuthPath: projectConfig.codexAuthPath,
          claudeAuthPath: "./.orch/auth/claude"
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
  migrateLegacyOrchLayout(baseDir, {
    envGlobalPath: globalConfig.envGlobalPath,
    envProjectPath: globalConfig.envProjectPath,
    codexAuthPath: globalConfig.codexAuthPath,
    ghAuthPath: resolveRootPath(".docker-git/.orch/auth/gh"),
    claudeAuthPath: resolveRootPath(".docker-git/.orch/auth/claude")
  })
