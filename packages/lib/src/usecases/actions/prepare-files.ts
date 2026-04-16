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
import { writeFileStringEnsuringParent } from "../volatile-files.js"
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
  path: Path.Path,
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

    yield* _(writeFileStringEnsuringParent(fs, path, resolved, nextContents))
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

const resolveManagedAuthorizedKeysSource = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  baseDir: string,
  preferredSource: string,
  resolved: string
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const preferred = resolvePathFromBase(path, baseDir, preferredSource)
    const preferredExists = yield* _(fs.exists(preferred))
    if (preferredExists && preferred !== resolved) {
      return preferred
    }

    return yield* _(resolveAuthorizedKeysSource(fs, path, process.cwd()))
  })

const ensureMissingAuthorizedKeysPlaceholder = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  resolved: string,
  state: ExistingFileState
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    if (state === "missing") {
      yield* _(writeFileStringEnsuringParent(fs, path, resolved, ""))
    }

    yield* _(
      Effect.logError(
        `Authorized keys not found. Create ${resolved} with your public key to enable SSH.`
      )
    )
  })

const readAuthorizedKeysContents = (
  fs: FileSystem.FileSystem,
  source: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const desiredContents = (yield* _(fs.readFileString(source))).trim()
    if (desiredContents.length === 0) {
      yield* _(Effect.logWarning(`Authorized keys source ${source} is empty. Skipping SSH key sync.`))
      return null
    }

    return desiredContents
  })

type AuthorizedKeysSyncTarget = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly state: ExistingFileState
  readonly resolved: string
  readonly managedDefaultAuthorizedKeys: string
  readonly source: string
  readonly desiredContents: string
  readonly overwriteExisting: boolean
}

const syncAuthorizedKeysTarget = ({
  desiredContents,
  fs,
  managedDefaultAuthorizedKeys,
  overwriteExisting,
  path,
  resolved,
  source,
  state
}: AuthorizedKeysSyncTarget): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    if (state === "exists") {
      if (overwriteExisting || resolved === managedDefaultAuthorizedKeys) {
        yield* _(appendKeyIfMissing(fs, path, resolved, source, desiredContents))
      }
      return
    }

    yield* _(writeFileStringEnsuringParent(fs, path, resolved, `${desiredContents}\n`))
    yield* _(Effect.log(`Authorized keys copied from ${source} to ${resolved}`))
  })

const ensureAuthorizedKeys = (
  baseDir: string,
  authorizedKeysPath: string,
  preferredSource: string,
  overwriteExisting: boolean
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

      if (state === "exists" && resolved !== managedDefaultAuthorizedKeys && !overwriteExisting) {
        return
      }

      const source = yield* _(
        resolveManagedAuthorizedKeysSource(fs, path, baseDir, preferredSource, resolved)
      )
      if (source === null) {
        yield* _(ensureMissingAuthorizedKeysPlaceholder(fs, path, resolved, state))
        return
      }

      const desiredContents = yield* _(readAuthorizedKeysContents(fs, source))
      if (desiredContents === null) {
        return
      }

      yield* _(
        syncAuthorizedKeysTarget({
          fs,
          path,
          state,
          resolved,
          managedDefaultAuthorizedKeys,
          source,
          desiredContents,
          overwriteExisting
        })
      )
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
  "MCP_PLAYWRIGHT_ISOLATED=0",
  "MCP_PLAYWRIGHT_CDP_GUARD=1",
  "MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE=1",
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

      yield* _(writeFileStringEnsuringParent(fs, path, resolved, defaultContents))
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
    const createdFiles = yield* _(writeProjectFiles(resolvedOutDir, projectConfig, rewriteManagedFiles))
    yield* _(
      ensureAuthorizedKeys(
        resolvedOutDir,
        projectConfig.authorizedKeysPath,
        globalConfig.authorizedKeysPath,
        options.force
      )
    )
    yield* _(ensureEnvFile(resolvedOutDir, projectConfig.envGlobalPath, defaultGlobalEnvContents))
    yield* _(ensureEnvFile(resolvedOutDir, projectConfig.envProjectPath, defaultProjectEnvContents, envOnlyRefresh))
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
