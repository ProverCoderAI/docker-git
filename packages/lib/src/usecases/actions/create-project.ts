import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import { deriveRepoPathParts } from "../../core/domain.js"
import { runCommandWithExitCodes } from "../../shell/command-runner.js"
import { ensureDockerDaemonAccess } from "../../shell/docker.js"
import { CommandFailedError } from "../../shell/errors.js"
import type {
  CloneFailedError,
  DockerAccessError,
  DockerCommandError,
  FileExistsError,
  PortProbeError
} from "../../shell/errors.js"
import { logDockerAccessInfo } from "../access-log.js"
import { renderError } from "../errors.js"
import { applyGithubForkConfig } from "../github-fork.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { findSshPrivateKey } from "../path-helpers.js"
import { buildSshCommand } from "../projects-core.js"
import { autoSyncState } from "../state-repo.js"
import { runDockerUpIfNeeded } from "./docker-up.js"
import { buildProjectConfigs, resolveDockerGitRootRelativePath } from "./paths.js"
import { resolveSshPort } from "./ports.js"
import { migrateProjectOrchLayout, prepareProjectFiles } from "./prepare-files.js"

type CreateProjectRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type CreateProjectError =
  | FileExistsError
  | CloneFailedError
  | DockerAccessError
  | DockerCommandError
  | PortProbeError
  | PlatformError

type CreateContext = {
  readonly baseDir: string
  readonly resolveRootPath: (value: string) => string
}

const makeCreateContext = (path: Path.Path, baseDir: string): CreateContext => {
  const projectsRoot = path.resolve(defaultProjectsRoot(baseDir))
  const resolveRootPath = (value: string): string => resolveDockerGitRootRelativePath(path, projectsRoot, value)
  return { baseDir, resolveRootPath }
}

const resolveRootedConfig = (command: CreateCommand, ctx: CreateContext): CreateCommand["config"] => ({
  ...command.config,
  dockerGitPath: ctx.resolveRootPath(command.config.dockerGitPath),
  authorizedKeysPath: ctx.resolveRootPath(command.config.authorizedKeysPath),
  envGlobalPath: ctx.resolveRootPath(command.config.envGlobalPath),
  envProjectPath: ctx.resolveRootPath(command.config.envProjectPath),
  codexAuthPath: ctx.resolveRootPath(command.config.codexAuthPath),
  codexSharedAuthPath: ctx.resolveRootPath(command.config.codexSharedAuthPath)
})

const resolveCreateConfig = (
  command: CreateCommand,
  ctx: CreateContext,
  resolvedOutDir: string
): Effect.Effect<
  CreateCommand["config"],
  PortProbeError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  resolveSshPort(resolveRootedConfig(command, ctx), resolvedOutDir).pipe(
    Effect.flatMap((config) => applyGithubForkConfig(config))
  )

const logCreatedProject = (resolvedOutDir: string, createdFiles: ReadonlyArray<string>) =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Created docker-git project in ${resolvedOutDir}`))
    for (const file of createdFiles) {
      yield* _(Effect.log(`  - ${file}`))
    }
  }).pipe(Effect.asVoid)

const formatStateSyncLabel = (repoUrl: string): string => {
  const repoPath = deriveRepoPathParts(repoUrl).pathParts.join("/")
  return repoPath.length > 0 ? repoPath : repoUrl
}

const isInteractiveTty = (): boolean => process.stdin.isTTY === true && process.stdout.isTTY === true

const buildSshArgs = (
  config: CreateCommand["config"],
  sshKeyPath: string | null
): ReadonlyArray<string> => {
  const args: Array<string> = []
  if (sshKeyPath !== null) {
    args.push("-i", sshKeyPath)
  }
  args.push(
    "-tt",
    "-Y",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(config.sshPort),
    `${config.sshUser}@localhost`
  )
  return args
}

// CHANGE: auto-open SSH after environment is created (best-effort)
// WHY: clone flow should drop the user into the container without manual copy/paste
// QUOTE(ТЗ): "Мне надо что бы он сразу открыл SSH"
// REF: issue-39
// SOURCE: n/a
// FORMAT THEOREM: forall c: openSsh(c) -> ssh_session_started(c) || warning_logged(c)
// PURITY: SHELL
// EFFECT: Effect<void, never, FileSystem | Path | CommandExecutor>
// INVARIANT: SSH failures do not fail the create/clone command
// COMPLEXITY: O(1) + ssh
const openSshBestEffort = (
  template: CreateCommand["config"]
): Effect.Effect<void, never, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const sshCommand = buildSshCommand(template, sshKey)

    yield* _(Effect.log(`Opening SSH: ${sshCommand}`))
    yield* _(
      runCommandWithExitCodes(
        {
          cwd: process.cwd(),
          command: "ssh",
          args: buildSshArgs(template, sshKey)
        },
        [0, 130],
        (exitCode) => new CommandFailedError({ command: "ssh", exitCode })
      )
    )
  }).pipe(
    Effect.catchAll((error) => Effect.logWarning(`SSH auto-open failed: ${renderError(error)}`)),
    Effect.asVoid
  )

const runCreateProject = (
  path: Path.Path,
  command: CreateCommand
): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    if (command.runUp) {
      yield* _(ensureDockerDaemonAccess(process.cwd()))
    }

    const ctx = makeCreateContext(path, process.cwd())
    const resolvedOutDir = path.resolve(ctx.resolveRootPath(command.outDir))

    const resolvedConfig = yield* _(resolveCreateConfig(command, ctx, resolvedOutDir))
    const { globalConfig, projectConfig } = buildProjectConfigs(path, ctx.baseDir, resolvedOutDir, resolvedConfig)

    yield* _(migrateProjectOrchLayout(ctx.baseDir, globalConfig, ctx.resolveRootPath))

    const createdFiles = yield* _(
      prepareProjectFiles(resolvedOutDir, ctx.baseDir, globalConfig, projectConfig, {
        force: command.force,
        forceEnv: command.forceEnv
      })
    )
    yield* _(logCreatedProject(resolvedOutDir, createdFiles))

    yield* _(
      runDockerUpIfNeeded(resolvedOutDir, projectConfig, {
        runUp: command.runUp,
        waitForClone: command.waitForClone,
        force: command.force,
        forceEnv: command.forceEnv
      })
    )
    if (command.runUp) {
      yield* _(logDockerAccessInfo(resolvedOutDir, projectConfig))
    }

    yield* _(autoSyncState(`chore(state): update ${formatStateSyncLabel(projectConfig.repoUrl)}`))

    if (command.openSsh) {
      if (!command.runUp) {
        yield* _(Effect.logWarning("Skipping SSH auto-open: docker compose up disabled (--no-up)."))
      } else if (!isInteractiveTty()) {
        yield* _(Effect.logWarning("Skipping SSH auto-open: not running in an interactive TTY."))
      } else {
        yield* _(openSshBestEffort(projectConfig))
      }
    }
  }).pipe(Effect.asVoid)

export const createProject = (command: CreateCommand): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Path.Path.pipe(Effect.flatMap((path) => runCreateProject(path, command)))
