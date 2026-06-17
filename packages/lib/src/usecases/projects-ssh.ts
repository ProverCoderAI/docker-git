import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Duration, Effect, pipe, Schedule } from "effect"

import { runCommandExitCode, runCommandWithExitCodes } from "../shell/command-runner.js"
import { runDockerComposePsFormatted, runDockerInspectContainerIp } from "../shell/docker.js"
import {
  CommandFailedError,
  type ConfigDecodeError,
  type ConfigNotFoundError,
  type DockerCommandError,
  type FileExistsError,
  type PortProbeError
} from "../shell/errors.js"
import { renderError } from "./errors.js"
import {
  buildSshCommand,
  forEachProjectStatus,
  formatComposeRows,
  getContainerIpIfInsideContainer,
  parseComposePsOutput,
  type ProjectItem,
  renderProjectStatusHeader,
  withProjectIndexAndSsh
} from "./projects-core.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"
import { buildEditorSshAccess, formatEditorSshAccessSummary } from "./ssh-access.js"
import { withPreservedTerminalState } from "./terminal-cursor.js"

export type PreparedProjectSsh = {
  readonly item: ProjectItem
  readonly cwd: string
  readonly command: "ssh"
  readonly args: ReadonlyArray<string>
}

type ProjectSshRuntime = CommandExecutor.CommandExecutor | FileSystem.FileSystem
type ProjectSshUpRequirements = ProjectSshRuntime | Path.Path

const buildSshArgs = (item: ProjectItem): ReadonlyArray<string> => {
  const host = item.ipAddress ?? "localhost"
  const port = item.ipAddress ? 22 : item.sshPort
  const args: Array<string> = []
  if (item.sshKeyPath !== null) {
    args.push("-i", item.sshKeyPath)
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
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(port),
    `${item.sshUser}@${host}`
  )
  return args
}

const buildSshProbeArgs = (item: ProjectItem): ReadonlyArray<string> => {
  const host = item.ipAddress ?? "localhost"
  const port = item.ipAddress ? 22 : item.sshPort
  const args: Array<string> = []
  if (item.sshKeyPath !== null) {
    args.push("-i", item.sshKeyPath)
  }
  args.push(
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=2",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(port),
    `${item.sshUser}@${host}`,
    "true"
  )
  return args
}

export const probeProjectSshReady = (
  item: ProjectItem
): Effect.Effect<boolean, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd: process.cwd(),
    command: "ssh",
    args: buildSshProbeArgs(item)
  }).pipe(Effect.map((exitCode) => exitCode === 0))

export const waitForProjectSshReady = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const host = item.ipAddress ?? "localhost"
  const port = item.ipAddress ? 22 : item.sshPort
  const probe = Effect.gen(function*(_) {
    const isReady = yield* _(probeProjectSshReady(item))
    if (!isReady) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "ssh wait", exitCode: 1 })))
    }
  })

  return pipe(
    Effect.log(`Waiting for SSH on ${host}:${port} ...`),
    Effect.zipRight(
      Effect.retry(
        probe,
        pipe(
          Schedule.spaced(Duration.seconds(2)),
          Schedule.intersect(Schedule.recurs(30))
        )
      )
    ),
    Effect.tap(() => Effect.log("SSH is ready."))
  )
}

export const prepareProjectSsh = (item: ProjectItem): PreparedProjectSsh => ({
  item,
  cwd: process.cwd(),
  command: "ssh",
  args: buildSshArgs(item)
})

const connectPreparedProjectSsh = (
  prepared: PreparedProjectSsh
): Effect.Effect<void, CommandFailedError | PlatformError, ProjectSshRuntime> =>
  withPreservedTerminalState(
    runCommandWithExitCodes(
      {
        cwd: prepared.cwd,
        command: prepared.command,
        args: prepared.args
      },
      [0, 130],
      (exitCode) => new CommandFailedError({ command: prepared.command, exitCode })
    )
  )

// CHANGE: connect to a project via SSH using its resolved settings
// WHY: allow TUI to open a shell immediately after selection
// QUOTE(ТЗ): "выбор проекта сразу подключает по SSH"
// REF: user-request-2026-02-02-select-ssh
// SOURCE: n/a
// FORMAT THEOREM: forall p: connect(p) -> ssh(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: command is ssh with deterministic args
// COMPLEXITY: O(1)
export const connectProjectSsh = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, ProjectSshRuntime> =>
  connectPreparedProjectSsh(prepareProjectSsh(item))

// CHANGE: ensure docker compose is up before SSH connection
// WHY: selected project should auto-start when not running
// QUOTE(ТЗ): "Если не поднят то пусть поднимает"
// REF: user-request-2026-02-02-select-up
// SOURCE: n/a
// FORMAT THEOREM: forall p: up(p) -> ssh(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | DockerCommandError | PlatformError, CommandExecutor | FileSystem | Path>
export const connectProjectSshWithUp = (
  item: ProjectItem
): Effect.Effect<
  void,
  | CommandFailedError
  | ConfigNotFoundError
  | ConfigDecodeError
  | FileExistsError
  | PortProbeError
  | DockerCommandError
  | PlatformError,
  ProjectSshUpRequirements
> =>
  prepareProjectSshWithUp(item).pipe(
    Effect.flatMap((prepared) => connectPreparedProjectSsh(prepared))
  )

export const prepareProjectSshWithUp = (
  item: ProjectItem
): Effect.Effect<
  PreparedProjectSsh,
  | CommandFailedError
  | ConfigNotFoundError
  | ConfigDecodeError
  | FileExistsError
  | PortProbeError
  | DockerCommandError
  | PlatformError,
  ProjectSshUpRequirements
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    yield* _(Effect.log(`Starting docker compose for ${item.displayName} ...`))
    const template = yield* _(runDockerComposeUpWithPortCheck(item.projectDir))

    const isInsideContainer = yield* _(fs.exists("/.dockerenv"))
    let ipAddress: string | undefined
    if (isInsideContainer) {
      const containerIp = yield* _(
        runDockerInspectContainerIp(item.projectDir, template.containerName).pipe(
          Effect.orElse(() => Effect.succeed(""))
        )
      )
      if (containerIp.length > 0) {
        ipAddress = containerIp
      }
    }

    const updated: ProjectItem = {
      ...item,
      sshPort: template.sshPort,
      ipAddress
    }

    yield* _(waitForProjectSshReady(updated))
    return prepareProjectSsh(updated)
  })

// CHANGE: show docker compose status for all known docker-git projects
// WHY: allow checking active containers without switching directories
// QUOTE(ТЗ): "как посмотреть какие активны?"
// REF: user-request-2026-01-27-status
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: status(p) -> output(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: each project emits a header before docker compose output
// COMPLEXITY: O(n) where n = |projects|
export const listProjectStatus: Effect.Effect<
  void,
  PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = withProjectIndexAndSsh((index, sshKey) =>
  forEachProjectStatus(index.configPaths, (status) =>
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const ipAddress = yield* _(
        getContainerIpIfInsideContainer(fs, status.projectDir, status.config.template.containerName)
      )

      const editorAccess = buildEditorSshAccess(status.config.template, sshKey, ipAddress)

      yield* _(Effect.log(renderProjectStatusHeader(status)))
      yield* _(Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey, ipAddress)}`))
      yield* _(Effect.log(formatEditorSshAccessSummary(editorAccess, status.config.template.clonedOnHostname)))

      const raw = yield* _(runDockerComposePsFormatted(status.projectDir))
      const rows = parseComposePsOutput(raw)
      const text = formatComposeRows(rows)
      yield* _(Effect.log(text))
    }).pipe(
      Effect.matchEffect({
        onFailure: (error: DockerCommandError | PlatformError) =>
          Effect.logWarning(
            `docker compose ps failed for ${status.projectDir}: ${renderError(error)}`
          ),
        onSuccess: () => Effect.void
      })
    ))
).pipe(Effect.asVoid)
