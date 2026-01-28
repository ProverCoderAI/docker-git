import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect, Fiber, Schedule } from "effect"

import type { CreateCommand } from "../core/domain.js"
import { runDockerComposeLogsFollow, runDockerComposeUp, runDockerExecExitCode } from "../shell/docker.js"
import { CloneFailedError } from "../shell/errors.js"
import type { DockerCommandError, PortProbeError } from "../shell/errors.js"
import { writeProjectFiles } from "../shell/files.js"
import { findAvailablePort } from "../shell/ports.js"
import { findAuthorizedKeysSource, findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"
import { buildSshCommand } from "./projects.js"

const resolvePathFromBase = (path: Path.Path, baseDir: string, targetPath: string): string =>
  path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath)

type ExistingFileState = "exists" | "missing"

const withFsPath = <A, E, R>(
  run: (
    fs: FileSystem.FileSystem,
    path: Path.Path
  ) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    return yield* _(run(fs, path))
  })

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
  withFsPath((fs, path) =>
    Effect.gen(function*(_) {
      const resolved = resolveAuthorizedKeysPath(path, baseDir, authorizedKeysPath)
      const state = yield* _(
        ensureFileReady(fs, resolved, (resolvedPath, backupPath) =>
          `Authorized keys was a directory, moved to ${backupPath}. Creating a file at ${resolvedPath}.`)
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

// CHANGE: ensure Codex auth directory exists for shared secrets
// WHY: enable global auth reuse across containers
// QUOTE(ТЗ): "удобно настраивать секреты для всех контейнеров"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall p: exists(dir(p)) -> codex_auth_dir(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: creates directory if missing
// COMPLEXITY: O(1)
const ensureCodexAuthDir = (
  baseDir: string,
  codexAuthPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPath((fs, path) =>
    Effect.gen(function*(_) {
      const resolved = resolvePathFromBase(path, baseDir, codexAuthPath)
      const exists = yield* _(fs.exists(resolved))
      if (exists) {
        const info = yield* _(fs.stat(resolved))
        if (info.type !== "Directory") {
          yield* _(
            Effect.logWarning(`Codex auth path is not a directory: ${resolved}`)
          )
        }
        return
      }

      yield* _(fs.makeDirectory(resolved, { recursive: true }))
    })
  )

const defaultEnvContents = "# docker-git env\n# KEY=value\n"

// CHANGE: ensure env files exist for shared credentials
// WHY: allow containers to read secrets from env_file without failing
// QUOTE(ТЗ): "удобная настройка ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall p: exists(file(p)) -> env_file(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: creates file if missing
// COMPLEXITY: O(1)
const ensureEnvFile = (
  baseDir: string,
  envPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPath((fs, path) =>
    Effect.gen(function*(_) {
      const resolved = resolvePathFromBase(path, baseDir, envPath)
      const state = yield* _(
        ensureFileReady(
          fs,
          resolved,
          (_resolvedPath, backupPath) => `Env file was a directory, moved to ${backupPath}.`
        )
      )
      if (state === "exists") {
        return
      }

      yield* _(fs.makeDirectory(path.dirname(resolved), { recursive: true }))
      yield* _(fs.writeFileString(resolved, defaultEnvContents))
    })
  )

// CHANGE: log SSH access command after container creation
// WHY: provide a single copy-paste command for immediate access
// QUOTE(ТЗ): "должен сразу же написать доступы по SSH"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall cfg: log(cfg) -> ssh_command(cfg)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: command string is deterministic for given config and key lookup
// COMPLEXITY: O(1)
const logSshAccess = (
  baseDir: string,
  config: CreateCommand["config"]
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedAuthorizedKeys = resolveAuthorizedKeysPath(path, baseDir, config.authorizedKeysPath)
    const authExists = yield* _(fs.exists(resolvedAuthorizedKeys))
    const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const sshCommand = buildSshCommand(config, sshKey)

    yield* _(Effect.log(`SSH access: ${sshCommand}`))
    if (!authExists) {
      yield* _(
        Effect.logWarning(
          `Authorized keys file missing: ${resolvedAuthorizedKeys} (SSH may fail without a matching key).`
        )
      )
    }
  })

const maxPortAttempts = 25
const clonePollInterval = Duration.seconds(1)
const cloneDonePath = "/run/docker-git/clone.done"
const cloneFailPath = "/run/docker-git/clone.failed"

const resolveSshPort = (
  config: CreateCommand["config"]
): Effect.Effect<CreateCommand["config"], PortProbeError> =>
  Effect.gen(function*(_) {
    const selected = yield* _(findAvailablePort(config.sshPort, maxPortAttempts))
    if (selected !== config.sshPort) {
      yield* _(
        Effect.logWarning(
          `SSH port ${config.sshPort} is already in use; using ${selected} instead.`
        )
      )
    }
    return selected === config.sshPort ? config : { ...config, sshPort: selected }
  })

type CloneState = "pending" | "done" | "failed"

const checkCloneState = (
  cwd: string,
  containerName: string
): Effect.Effect<CloneState, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const failed = yield* _(runDockerExecExitCode(cwd, containerName, ["test", "-f", cloneFailPath]))
    if (failed === 0) {
      return "failed"
    }

    const done = yield* _(runDockerExecExitCode(cwd, containerName, ["test", "-f", cloneDonePath]))
    return done === 0 ? "done" : "pending"
  })

const waitForCloneCompletion = (
  cwd: string,
  config: CreateCommand["config"]
): Effect.Effect<void, CloneFailedError | DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const logsFiber = yield* _(
      runDockerComposeLogsFollow(cwd).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.fork
      )
    )
    const result = yield* _(
      checkCloneState(cwd, config.containerName).pipe(
        Effect.repeat(
          Schedule.addDelay(
            Schedule.recurUntil<CloneState>((state) => state !== "pending"),
            () => clonePollInterval
          )
        )
      )
    )
    yield* _(Fiber.interrupt(logsFiber))
    if (result === "failed") {
      return yield* _(
        Effect.fail(
          new CloneFailedError({
            repoUrl: config.repoUrl,
            repoRef: config.repoRef,
            targetDir: config.targetDir
          })
        )
      )
    }
  })

// CHANGE: orchestrate project creation in the shell layer
// WHY: reuse the same creation flow for CLI and interactive menu
// QUOTE(ТЗ): "Надо написать CLI команду с помощью которой мы будем создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: create(cmd) -> files_written(cmd.outDir)
// PURITY: SHELL
// EFFECT: Effect<void, FileExistsError | CloneFailedError | DockerCommandError | PortProbeError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: docker compose runs only when runUp = true
// COMPLEXITY: O(n) where n = |files|
export const createProject = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const resolvedOutDir = path.resolve(command.outDir)
    const resolvedConfig = yield* _(resolveSshPort(command.config))
    const createdFiles = yield* _(writeProjectFiles(resolvedOutDir, resolvedConfig, command.force))

    yield* _(ensureAuthorizedKeys(resolvedOutDir, resolvedConfig.authorizedKeysPath))
    yield* _(ensureEnvFile(resolvedOutDir, resolvedConfig.envGlobalPath))
    yield* _(ensureEnvFile(resolvedOutDir, resolvedConfig.envProjectPath))
    yield* _(ensureCodexAuthDir(resolvedOutDir, resolvedConfig.codexAuthPath))

    yield* _(Effect.log(`Created docker-git project in ${resolvedOutDir}`))

    for (const file of createdFiles) {
      yield* _(Effect.log(`  - ${file}`))
    }

    if (command.runUp) {
      yield* _(Effect.log("Running: docker compose up -d --build"))
      yield* _(runDockerComposeUp(resolvedOutDir))
      if (command.waitForClone) {
        yield* _(Effect.log("Streaming container logs until clone completes..."))
        yield* _(waitForCloneCompletion(resolvedOutDir, resolvedConfig))
      }
      yield* _(Effect.log("Docker environment is up"))
      yield* _(logSshAccess(resolvedOutDir, resolvedConfig))
    }
  })
