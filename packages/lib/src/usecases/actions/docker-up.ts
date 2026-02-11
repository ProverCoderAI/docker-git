import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect, Fiber, Schedule } from "effect"

import type { CreateCommand } from "../../core/domain.js"
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
import { CloneFailedError } from "../../shell/errors.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath } from "../path-helpers.js"
import { buildSshCommand } from "../projects.js"

const maxPortAttempts = 25
const clonePollInterval = Duration.seconds(1)
const cloneDonePath = "/run/docker-git/clone.done"
const cloneFailPath = "/run/docker-git/clone.failed"

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

type CloneState = "pending" | "done" | "failed"
type DockerUpError = CloneFailedError | DockerCommandError | PlatformError
type DockerUpEnvironment = CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path

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

const runDockerComposeUpByMode = (
  resolvedOutDir: string,
  force: boolean,
  forceEnv: boolean
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    if (force) {
      yield* _(Effect.log("Force enabled: wiping docker compose volumes (docker compose down -v)..."))
      yield* _(runDockerComposeDownVolumes(resolvedOutDir))
      yield* _(Effect.log("Running: docker compose up -d --build"))
      yield* _(runDockerComposeUp(resolvedOutDir))
      return
    }
    if (forceEnv) {
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
  runUp: boolean,
  waitForClone: boolean,
  force: boolean,
  forceEnv: boolean
): Effect.Effect<void, DockerUpError, DockerUpEnvironment> =>
  Effect.gen(function*(_) {
    if (!runUp) {
      return
    }
    yield* _(runDockerComposeUpByMode(resolvedOutDir, force, forceEnv))
    yield* _(ensureBridgeAccess(resolvedOutDir, projectConfig))

    if (waitForClone) {
      yield* _(Effect.log("Streaming container logs until clone completes..."))
      yield* _(waitForCloneCompletion(resolvedOutDir, projectConfig))
    }
    yield* _(Effect.log("Docker environment is up"))
    yield* _(logSshAccess(resolvedOutDir, projectConfig))
  })

export const maxSshPortAttempts = maxPortAttempts
