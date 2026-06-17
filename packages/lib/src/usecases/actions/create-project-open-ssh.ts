import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { CreateCommand } from "../../core/domain.js"
import { runCommandWithExitCodes } from "../../shell/command-runner.js"
import { CommandFailedError } from "../../shell/errors.js"
import { renderError } from "../errors.js"
import { findSshPrivateKey } from "../path-helpers.js"
import { buildSshCommand, getContainerIpIfInsideContainer } from "../projects-core.js"
import { withPreservedTerminalState } from "../terminal-cursor.js"

type CreateProjectOpenSshRuntime =
  | FileSystem.FileSystem
  | Path.Path
  | CommandExecutor.CommandExecutor

const isInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

const buildSshArgs = (
  config: CreateCommand["config"],
  sshKeyPath: string | null,
  remoteCommand?: string,
  ipAddress?: string
): ReadonlyArray<string> => {
  const host = ipAddress ?? "localhost"
  const port = ipAddress ? 22 : config.sshPort
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
    String(port),
    `${config.sshUser}@${host}`
  )
  if (remoteCommand !== undefined) {
    args.push(remoteCommand)
  }
  return args
}

const openSshBestEffort = (
  template: CreateCommand["config"],
  remoteCommand?: string
): Effect.Effect<void, never, CreateProjectOpenSshRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const ipAddress = yield* _(
      getContainerIpIfInsideContainer(fs, process.cwd(), template.containerName).pipe(
        Effect.orElse(() => Effect.succeed<string | undefined>(""))
      )
    )

    const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const sshCommand = buildSshCommand(template, sshKey, ipAddress)
    const remoteCommandLabel = remoteCommand === undefined ? "" : ` (${remoteCommand})`

    yield* _(Effect.log(`Opening SSH: ${sshCommand}${remoteCommandLabel}`))
    const sshArgs = buildSshArgs(template, sshKey, remoteCommand, ipAddress)
    const sshCommandSpec = { cwd: process.cwd(), command: "ssh", args: sshArgs }
    yield* _(
      withPreservedTerminalState(
        runCommandWithExitCodes(
          sshCommandSpec,
          [0, 130],
          (exitCode) => new CommandFailedError({ command: "ssh", exitCode })
        )
      )
    )
  }).pipe(
    Effect.asVoid,
    Effect.matchEffect({
      onFailure: (error) => Effect.logWarning(`SSH auto-open failed: ${renderError(error)}`),
      onSuccess: () => Effect.void
    })
  )

const resolveInteractiveRemoteCommand = (
  projectConfig: CreateCommand["config"],
  isInteractiveAgent: boolean
): string | undefined =>
  isInteractiveAgent && projectConfig.agentMode !== undefined
    ? `cd '${projectConfig.targetDir}' && ${projectConfig.agentMode}`
    : undefined

export const maybeOpenSsh = (
  command: CreateCommand,
  hasAgent: boolean,
  shouldWaitForAgent: boolean,
  projectConfig: CreateCommand["config"]
): Effect.Effect<void, never, CreateProjectOpenSshRuntime> =>
  Effect.gen(function*(_) {
    const isInteractiveAgent = hasAgent && !shouldWaitForAgent
    if (!command.openSsh || (hasAgent && !isInteractiveAgent)) {
      return
    }

    if (!command.runUp) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: docker compose up disabled (--no-up)."))
      return
    }

    if (!isInteractiveTty()) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: not running in an interactive TTY."))
      return
    }

    const remoteCommand = resolveInteractiveRemoteCommand(projectConfig, isInteractiveAgent)
    yield* _(openSshBestEffort(projectConfig, remoteCommand))
  }).pipe(Effect.asVoid)
