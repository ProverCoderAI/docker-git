/* jscpd:ignore-start */
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand, ParseError } from "../../core/domain.js"
import { deriveRepoPathParts } from "../../core/domain.js"
import { ensureDockerDaemonAccess } from "../../shell/docker.js"
import type {
  AgentFailedError,
  AuthError,
  CloneFailedError,
  DockerAccessError,
  DockerCommandError,
  DockerIdentityConflictError,
  FileExistsError,
  PortProbeError
} from "../../shell/errors.js"
import { logDockerAccessInfo } from "../access-log.js"
import { resolveAutoAgentMode } from "../agent-auto-select.js"
import { applyGithubForkConfig } from "../github-fork.js"
import { validateGithubCloneAuthTokenPreflight } from "../github-token-preflight.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { resolveTemplateResourceLimits } from "../resource-limits.js"
import { autoSyncState } from "../state-repo.js"
import { deleteConflictingProjectsIfNeeded } from "./create-project-conflicts.js"
import { maybeOpenSsh } from "./create-project-open-ssh.js"
import { runDockerDownCleanup, runDockerUpIfNeeded } from "./docker-up.js"
import { buildProjectConfigs, resolveDockerGitRootRelativePath } from "./paths.js"
import { resolveSshPort } from "./ports.js"
import { migrateProjectOrchLayout, prepareProjectFiles } from "./prepare-files.js"

type CreateProjectRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type CreateProjectError =
  | FileExistsError
  | CloneFailedError
  | AgentFailedError
  | AuthError
  | DockerAccessError
  | DockerCommandError
  | DockerIdentityConflictError
  | PortProbeError
  | ParseError
  | PlatformError

type CreateContext = {
  readonly baseDir: string
  readonly resolveRootPath: (value: string) => string
}

type BuiltProjectConfigs = ReturnType<typeof buildProjectConfigs>
type PreparedProject = {
  readonly resolvedOutDir: string
  readonly finalConfig: CreateCommand["config"]
  readonly globalConfig: BuiltProjectConfigs["globalConfig"]
  readonly projectConfig: BuiltProjectConfigs["projectConfig"]
}

const resolveClonedOnHostname = (): Effect.Effect<string | undefined> =>
  Effect.tryPromise({
    try: () => import("node:os").then((os) => os.hostname()),
    catch: () => new Error("hostname lookup failed")
  }).pipe(
    Effect.match({
      onFailure: (): string | undefined => undefined,
      onSuccess: (hostname): string | undefined => hostname
    })
  )

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
  rootedConfig: CreateCommand["config"],
  resolvedOutDir: string
): Effect.Effect<
  CreateCommand["config"],
  PortProbeError | PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  resolveSshPort(rootedConfig, resolvedOutDir).pipe(
    Effect.flatMap((config) => applyGithubForkConfig(config)),
    Effect.flatMap((config) => resolveTemplateResourceLimits(config))
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

const resolveFinalAgentConfig = (
  resolvedConfig: CreateCommand["config"]
): Effect.Effect<CreateCommand["config"], ParseError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const resolvedAgentMode = yield* _(resolveAutoAgentMode(resolvedConfig))
    if (
      (resolvedConfig.agentAuto ?? false) && resolvedConfig.agentMode === undefined && resolvedAgentMode !== undefined
    ) {
      yield* _(Effect.log(`Auto agent selected: ${resolvedAgentMode}`))
    }
    return resolvedAgentMode === undefined ? resolvedConfig : { ...resolvedConfig, agentMode: resolvedAgentMode }
  })

const resolveRuntimeConfig = (
  resolvedConfig: CreateCommand["config"]
): Effect.Effect<CreateCommand["config"], ParseError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const finalAgentConfig = yield* _(resolveFinalAgentConfig(resolvedConfig))
    const clonedOnHostname = yield* _(resolveClonedOnHostname())
    return clonedOnHostname === undefined
      ? finalAgentConfig
      : { ...finalAgentConfig, clonedOnHostname }
  })

const maybeCleanupAfterAgent = (
  waitForAgent: boolean,
  resolvedOutDir: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    if (!waitForAgent) {
      return
    }
    yield* _(Effect.log("Agent finished. Cleaning up container..."))
    yield* _(runDockerDownCleanup(resolvedOutDir))
  })

export const prepareProject = (
  path: Path.Path,
  command: CreateCommand
): Effect.Effect<PreparedProject, CreateProjectError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    if (command.runUp) {
      yield* _(ensureDockerDaemonAccess(process.cwd()))
    }

    const ctx = makeCreateContext(path, process.cwd())
    const resolvedOutDir = path.resolve(ctx.resolveRootPath(command.outDir))
    const rootedConfig = resolveRootedConfig(command, ctx)

    yield* _(
      deleteConflictingProjectsIfNeeded(resolvedOutDir, rootedConfig, command.force)
    )
    yield* _(validateGithubCloneAuthTokenPreflight(rootedConfig))

    const resolvedConfig = yield* _(resolveCreateConfig(rootedConfig, resolvedOutDir))
    const finalConfig = yield* _(resolveRuntimeConfig(resolvedConfig))
    const { globalConfig, projectConfig } = buildProjectConfigs(path, ctx.baseDir, resolvedOutDir, finalConfig)

    yield* _(migrateProjectOrchLayout(ctx.baseDir, globalConfig, ctx.resolveRootPath))
    const createdFiles = yield* _(
      prepareProjectFiles(resolvedOutDir, ctx.baseDir, globalConfig, projectConfig, {
        force: command.force,
        forceEnv: command.forceEnv
      })
    )
    yield* _(logCreatedProject(resolvedOutDir, createdFiles))
    return { resolvedOutDir, finalConfig, globalConfig, projectConfig }
  })

export const runPreparedProject = (
  command: CreateCommand,
  prepared: PreparedProject
): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const hasAgent = prepared.finalConfig.agentMode !== undefined
    const waitForAgent = hasAgent && (prepared.finalConfig.agentAuto ?? false)

    yield* _(autoSyncState(`chore(state): update ${formatStateSyncLabel(prepared.projectConfig.repoUrl)}`))
    yield* _(
      runDockerUpIfNeeded(prepared.resolvedOutDir, prepared.projectConfig, {
        runUp: command.runUp,
        waitForClone: command.waitForClone,
        waitForAgent,
        force: command.force,
        forceEnv: command.forceEnv
      })
    )
    if (command.runUp) {
      yield* _(logDockerAccessInfo(prepared.resolvedOutDir, prepared.projectConfig))
    }

    yield* _(maybeCleanupAfterAgent(waitForAgent, prepared.resolvedOutDir))
    yield* _(maybeOpenSsh(command, hasAgent, waitForAgent, prepared.projectConfig))
  }).pipe(Effect.asVoid)

const runCreateProject = (
  path: Path.Path,
  command: CreateCommand
): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareProject(path, command))
    yield* _(runPreparedProject(command, prepared))
  }).pipe(Effect.asVoid)

export const createProject = (command: CreateCommand): Effect.Effect<void, CreateProjectError, CreateProjectRuntime> =>
  Path.Path.pipe(Effect.flatMap((path) => runCreateProject(path, command)))
/* jscpd:ignore-end */
