import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import { deriveRepoPathParts } from "../../core/domain.js"
import type { CloneFailedError, DockerCommandError, FileExistsError, PortProbeError } from "../../shell/errors.js"
import { logDockerAccessInfo } from "../access-log.js"
import { applyGithubForkConfig } from "../github-fork.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { autoSyncState } from "../state-repo.js"
import { runDockerUpIfNeeded } from "./docker-up.js"
import { buildProjectConfigs, resolveDockerGitRootRelativePath } from "./paths.js"
import { resolveSshPort } from "./ports.js"
import { migrateProjectOrchLayout, prepareProjectFiles } from "./prepare-files.js"

type CreateProjectRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type CreateProjectError =
  | FileExistsError
  | CloneFailedError
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

const runCreateProject = (
  path: Path.Path,
  command: CreateCommand
): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const ctx = makeCreateContext(path, process.cwd())
    const resolvedOutDir = path.resolve(ctx.resolveRootPath(command.outDir))

    const resolvedConfig = yield* _(resolveCreateConfig(command, ctx, resolvedOutDir))
    const { globalConfig, projectConfig } = buildProjectConfigs(path, ctx.baseDir, resolvedOutDir, resolvedConfig)

    yield* _(migrateProjectOrchLayout(ctx.baseDir, globalConfig, ctx.resolveRootPath))

    const createdFiles = yield* _(
      prepareProjectFiles(resolvedOutDir, ctx.baseDir, globalConfig, projectConfig, command.force)
    )
    yield* _(logCreatedProject(resolvedOutDir, createdFiles))

    yield* _(runDockerUpIfNeeded(resolvedOutDir, projectConfig, command.runUp, command.waitForClone, command.force))
    if (command.runUp) {
      yield* _(logDockerAccessInfo(resolvedOutDir, projectConfig))
    }

    yield* _(autoSyncState(`chore(state): update ${formatStateSyncLabel(projectConfig.repoUrl)}`))
  }).pipe(Effect.asVoid)

export const createProject = (command: CreateCommand): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Path.Path.pipe(Effect.flatMap((path) => runCreateProject(path, command)))
