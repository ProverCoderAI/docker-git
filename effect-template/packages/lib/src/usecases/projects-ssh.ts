import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import { Duration, Effect, Schedule, pipe } from "effect"

import { runCommandExitCode, runCommandWithExitCodes } from "../shell/command-runner.js"
import { runDockerComposePsFormatted } from "../shell/docker.js"
import type {
  ConfigDecodeError,
  ConfigNotFoundError,
  DockerCommandError,
  FileExistsError,
  PortProbeError
} from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { renderError } from "./errors.js"
import {
  buildSshCommand,
  formatComposeRows,
  loadProjectStatus,
  parseComposePsOutput,
  type ProjectItem,
  type ProjectStatus,
  renderProjectStatusHeader,
  skipWithWarning,
  withProjectIndexAndSsh
} from "./projects-core.js"
import { runDockerComposeUpWithPortCheck } from "./projects-up.js"

const buildSshArgs = (item: ProjectItem): ReadonlyArray<string> => {
  const args: Array<string> = []
  if (item.sshKeyPath !== null) {
    args.push("-i", item.sshKeyPath)
  }
  args.push(
    "-tt",
    "-Y",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(item.sshPort),
    `${item.sshUser}@localhost`
  )
  return args
}

const buildSshProbeArgs = (item: ProjectItem): ReadonlyArray<string> => {
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
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(item.sshPort),
    `${item.sshUser}@localhost`,
    "true"
  )
  return args
}

const waitForSshReady = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
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
    Effect.log(`Waiting for SSH on localhost:${item.sshPort} ...`),
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
  runCommandWithExitCodes(
    {
      cwd: process.cwd(),
      command: "ssh",
      args: buildSshArgs(item)
    },
    [0, 130],
    (exitCode) => new CommandFailedError({ command: "ssh", exitCode })
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
    Effect.gen(function*(_) {
      for (const configPath of index.configPaths) {
        const status = yield* _(
          loadProjectStatus(configPath).pipe(
            Effect.matchEffect({
              onFailure: skipWithWarning<ProjectStatus>(configPath),
              onSuccess: (value) => Effect.succeed(value)
            })
          )
        )
        if (status === null) {
          continue
        }

        yield* _(Effect.log(renderProjectStatusHeader(status)))
        yield* _(Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey)}`))
        yield* _(
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
      }
    })
  )
)
