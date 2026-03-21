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
import { ensureTerminalCursorVisible } from "./terminal-cursor.js"

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

const waitForSshReady = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const host = item.ipAddress ?? "localhost"
  const port = item.ipAddress ? 22 : item.sshPort
  const probe = Effect.gen(function*(_) {
    const exitCode = yield* _(
      runCommandExitCode({
        cwd: process.cwd(),
        command: "ssh",
        args: buildSshProbeArgs(item)
      })
    )
    if (exitCode !== 0) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "ssh wait", exitCode })))
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
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    ensureTerminalCursorVisible(),
    Effect.zipRight(
      runCommandWithExitCodes(
        {
          cwd: process.cwd(),
          command: "ssh",
          args: buildSshArgs(item)
        },
        [0, 130],
        (exitCode) => new CommandFailedError({ command: "ssh", exitCode })
      )
    ),
    Effect.ensuring(ensureTerminalCursorVisible())
  )

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
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
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

    yield* _(waitForSshReady(updated))
    yield* _(connectProjectSsh(updated))
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

      yield* _(Effect.log(renderProjectStatusHeader(status)))
      yield* _(Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey, ipAddress)}`))

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
