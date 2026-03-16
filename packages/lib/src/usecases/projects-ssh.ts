import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Duration, Effect, pipe, Schedule } from "effect"

import { runCommandExitCode, runCommandWithExitCodes } from "../shell/command-runner.js"
import { isInsideDocker } from "../shell/docker-env.js"
import { runDockerComposePsFormatted } from "../shell/docker.js"
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
  parseComposePsOutput,
  type ProjectItem,
  renderProjectStatusHeader,
  withProjectIndexAndSsh
} from "./projects-core.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"
import { ensureTerminalCursorVisible } from "./terminal-cursor.js"

// CHANGE: resolve SSH host and port based on environment
// WHY: in DinD, connect via container name on Docker shared network at port 22;
//      outside Docker, use localhost with the mapped host port
// PURITY: CORE
// INVARIANT: DinD → (containerName, 22); host → (localhost, sshPort)
type SshTarget = { readonly host: string; readonly port: number }

const resolveSshTarget = (item: ProjectItem): SshTarget =>
  isInsideDocker()
    ? { host: item.containerName, port: 22 }
    : { host: "localhost", port: item.sshPort }

const buildSshArgs = (item: ProjectItem): ReadonlyArray<string> => {
  const target = resolveSshTarget(item)
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
    String(target.port),
    `${item.sshUser}@${target.host}`
  )
  return args
}

// CHANGE: SSH probe uses sshpass when no key is available
// WHY: BatchMode=yes prevents password auth, making probe fail in DinD where no private key exists;
//      sshpass with default password (= sshUser) allows authentication
// PURITY: CORE
const buildSshProbeArgs = (item: ProjectItem): { readonly command: string; readonly args: ReadonlyArray<string> } => {
  const target = resolveSshTarget(item)
  const args: Array<string> = []
  if (item.sshKeyPath === null) {
    return {
      command: "sshpass",
      args: [
        "-p", item.sshUser,
        "ssh",
        "-T",
        "-o", "ConnectTimeout=2",
        "-o", "ConnectionAttempts=1",
        "-o", "LogLevel=ERROR",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-p", String(target.port),
        `${item.sshUser}@${target.host}`,
        "true"
      ]
    }
  }
  args.push("-i", item.sshKeyPath)
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
    String(target.port),
    `${item.sshUser}@${target.host}`,
    "true"
  )
  return { command: "ssh", args }
}

const waitForSshReady = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const probeSpec = buildSshProbeArgs(item)
  const target = resolveSshTarget(item)
  const probe = Effect.gen(function*(_) {
    const exitCode = yield* _(
      runCommandExitCode({
        cwd: process.cwd(),
        command: probeSpec.command,
        args: probeSpec.args
      })
    )
    if (exitCode !== 0) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "ssh wait", exitCode })))
    }
  })

  return pipe(
    Effect.log(`Waiting for SSH on ${target.host}:${target.port} ...`),
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
// INVARIANT: docker compose up runs before ssh
// COMPLEXITY: O(1)
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
  CommandExecutor.CommandExecutor | Fs | PathService
> =>
  pipe(
    Effect.log(`Starting docker compose for ${item.displayName} ...`),
    Effect.zipRight(runDockerComposeUpWithPortCheck(item.projectDir)),
    Effect.map((template) => ({ ...item, sshPort: template.sshPort })),
    Effect.tap((updated) => waitForSshReady(updated)),
    Effect.flatMap((updated) => connectProjectSsh(updated))
  )

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
  Fs | PathService | CommandExecutor.CommandExecutor
> = Effect.asVoid(
  withProjectIndexAndSsh((index, sshKey) =>
    forEachProjectStatus(index.configPaths, (status) =>
      pipe(
        Effect.log(renderProjectStatusHeader(status)),
        Effect.zipRight(
          Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey)}`)
        ),
        Effect.zipRight(
          runDockerComposePsFormatted(status.projectDir).pipe(
            Effect.map((raw) => parseComposePsOutput(raw)),
            Effect.map((rows) => formatComposeRows(rows)),
            Effect.flatMap((text) => Effect.log(text)),
            Effect.matchEffect({
              onFailure: (error: DockerCommandError | PlatformError) =>
                Effect.logWarning(
                  `docker compose ps failed for ${status.projectDir}: ${renderError(error)}`
                ),
              onSuccess: () => Effect.void
            })
          )
        )
      ))
  )
)
