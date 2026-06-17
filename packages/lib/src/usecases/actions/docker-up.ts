import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Duration, Effect, Fiber, Schedule } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import { runCommandWithExitCodes } from "../../shell/command-runner.js"
import {
  runDockerComposeDownVolumes,
  runDockerComposeLogsFollow,
  runDockerComposeUp,
  runDockerComposeUpRecreate,
  runDockerExecExitCode,
  runDockerInspectContainerBridgeIp,
  runDockerNetworkConnectBridge
} from "../../shell/docker.js"
import type { DockerCommandError } from "../../shell/errors.js"
import { AgentFailedError, CloneFailedError, CommandFailedError } from "../../shell/errors.js"
import { ensureComposeNetworkReady } from "../docker-network-gc.js"
import { ensureSharedCodexVolumeReady } from "../shared-volume-seed.js"
import { formatEditorSshAccessDetails, resolveProjectSshAccess } from "../ssh-access.js"

const maxPortAttempts = 25
const clonePollInterval = Duration.seconds(1)
const agentPollInterval = Duration.seconds(2)
const cloneDonePath = "/run/docker-git/clone.done"
const cloneFailPath = "/run/docker-git/clone.failed"
const agentDonePath = "/run/docker-git/agent.done"
const agentFailPath = "/run/docker-git/agent.failed"

const logSshAccess = (
  baseDir: string,
  config: CreateCommand["config"]
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const access = yield* _(resolveProjectSshAccess(baseDir, config))

    yield* _(Effect.log(`SSH access: ${access.sshCommand}`))
    yield* _(Effect.log(formatEditorSshAccessDetails(access.editor, config.clonedOnHostname)))
    if (!access.authorizedKeysExists) {
      yield* _(
        Effect.logWarning(
          `Authorized keys file missing: ${access.authorizedKeysPath} (SSH may fail without a matching key).`
        )
      )
    }
  })

type CloneState = "pending" | "done" | "failed"
type AgentState = "pending" | "done" | "failed"
type DockerUpError = CloneFailedError | AgentFailedError | DockerCommandError | PlatformError
type DockerUpEnvironment = CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
type DockerUpOptions = {
  readonly runUp: boolean
  readonly waitForClone: boolean
  readonly waitForAgent: boolean
  readonly force: boolean
  readonly forceEnv: boolean
}

const removeConflictingContainer = (
  cwd: string,
  containerName: string
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["rm", "-f", containerName]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: `docker rm -f ${containerName}`, exitCode })
  ).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.void,
      onSuccess: () => Effect.log(`Removed container before force restart: ${containerName}`)
    }),
    Effect.asVoid
  )

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
        Effect.tapError((error) =>
          Effect.logWarning(
            `docker compose logs --follow failed: ${error instanceof Error ? error.message : String(error)}`
          )
        ),
        Effect.fork
      )
    )
    const clonePollSchedule = Schedule.addDelay(
      Schedule.recurUntil<CloneState>((state) => state !== "pending"),
      () => clonePollInterval
    )
    const result = yield* _(
      checkCloneState(cwd, config.containerName).pipe(Effect.repeat(clonePollSchedule))
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

const checkAgentState = (
  cwd: string,
  containerName: string
): Effect.Effect<AgentState, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const failed = yield* _(runDockerExecExitCode(cwd, containerName, ["test", "-f", agentFailPath]))
    if (failed === 0) {
      return "failed"
    }

    const done = yield* _(runDockerExecExitCode(cwd, containerName, ["test", "-f", agentDonePath]))
    return done === 0 ? "done" : "pending"
  })

const waitForAgentCompletion = (
  cwd: string,
  config: CreateCommand["config"]
): Effect.Effect<void, AgentFailedError | DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const logsFiber = yield* _(
      runDockerComposeLogsFollow(cwd).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            `docker compose logs --follow failed: ${error instanceof Error ? error.message : String(error)}`
          )
        ),
        Effect.fork
      )
    )
    const agentPollSchedule = Schedule.addDelay(
      Schedule.recurUntil<AgentState>((state) => state !== "pending"),
      () => agentPollInterval
    )
    const result = yield* _(
      checkAgentState(cwd, config.containerName).pipe(Effect.repeat(agentPollSchedule))
    )
    yield* _(Fiber.interrupt(logsFiber))
    if (result === "failed") {
      return yield* _(
        Effect.fail(
          new AgentFailedError({
            agentMode: config.agentMode ?? "unknown",
            targetDir: config.targetDir
          })
        )
      )
    }
  })

const runDockerComposeUpByMode = (
  resolvedOutDir: string,
  projectConfig: CreateCommand["config"],
  shouldForce: boolean,
  shouldForceEnv: boolean
): Effect.Effect<void, DockerCommandError | PlatformError, DockerUpEnvironment> =>
  Effect.gen(function*(_) {
    yield* _(ensureComposeNetworkReady(resolvedOutDir, projectConfig))

    if (shouldForce) {
      yield* _(Effect.log("Force enabled: removing stale containers and wiping docker compose volumes..."))
      yield* _(runDockerComposeDownVolumes(resolvedOutDir))
      yield* _(ensureSharedCodexVolumeReady(resolvedOutDir, projectConfig))
      yield* _(removeConflictingContainer(resolvedOutDir, projectConfig.containerName))
      if (projectConfig.enableMcpPlaywright) {
        yield* _(removeConflictingContainer(resolvedOutDir, `${projectConfig.containerName}-browser`))
      }
      yield* _(Effect.log("Running: docker compose up -d --build"))
      yield* _(runDockerComposeUp(resolvedOutDir))
      return
    }
    yield* _(ensureSharedCodexVolumeReady(resolvedOutDir, projectConfig))
    if (shouldForceEnv) {
      yield* _(Effect.log("Force env enabled: resetting env defaults and recreating containers (volumes preserved)..."))
      yield* _(runDockerComposeUpRecreate(resolvedOutDir))
      return
    }
    yield* _(Effect.log("Running: docker compose up -d --build"))
    yield* _(runDockerComposeUp(resolvedOutDir))
  })

const ensureContainerBridgeAccess = (
  resolvedOutDir: string,
  containerName: string
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  runDockerInspectContainerBridgeIp(resolvedOutDir, containerName).pipe(
    Effect.flatMap((bridgeIp) =>
      bridgeIp.length > 0
        ? Effect.void
        : runDockerNetworkConnectBridge(resolvedOutDir, containerName)
    ),
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.logWarning(
          `Failed to connect ${containerName} to bridge network: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      onSuccess: () => Effect.void
    })
  )

const ensureBridgeAccess = (
  resolvedOutDir: string,
  projectConfig: CreateCommand["config"]
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    // Make container ports reachable from other (non-compose) containers by IP.
    yield* _(ensureContainerBridgeAccess(resolvedOutDir, projectConfig.containerName))
    if (projectConfig.enableMcpPlaywright) {
      yield* _(ensureContainerBridgeAccess(resolvedOutDir, `${projectConfig.containerName}-browser`))
    }
  })

export const runDockerUpIfNeeded = (
  resolvedOutDir: string,
  projectConfig: CreateCommand["config"],
  options: DockerUpOptions
): Effect.Effect<void, DockerUpError, DockerUpEnvironment> =>
  Effect.gen(function*(_) {
    if (!options.runUp) {
      return
    }
    yield* _(runDockerComposeUpByMode(resolvedOutDir, projectConfig, options.force, options.forceEnv))
    yield* _(ensureBridgeAccess(resolvedOutDir, projectConfig))

    if (options.waitForClone) {
      yield* _(Effect.log("Streaming container logs until clone completes..."))
      yield* _(waitForCloneCompletion(resolvedOutDir, projectConfig))
    }
    if (options.waitForAgent) {
      yield* _(Effect.log("Waiting for agent to complete..."))
      yield* _(waitForAgentCompletion(resolvedOutDir, projectConfig))
    }
    yield* _(Effect.log("Docker environment is up"))
    yield* _(logSshAccess(resolvedOutDir, projectConfig))
  })

export const runDockerDownCleanup = (
  resolvedOutDir: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerComposeDownVolumes(resolvedOutDir).pipe(
    Effect.tap(() => Effect.log("Container and volumes removed."))
  )

export const maxSshPortAttempts = maxPortAttempts
