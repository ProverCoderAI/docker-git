import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

const runCompose = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "docker", args: ["compose", ...args] },
    okExitCodes,
    (exitCode) => new DockerCommandError({ exitCode })
  )

// CHANGE: run docker compose up -d --build in the target directory
// WHY: provide a controlled shell effect for image creation
// QUOTE(ТЗ): "создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> image_built(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeUp = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["up", "-d", "--build"], [Number(ExitCode(0))])

// CHANGE: run docker compose down in the target directory
// WHY: allow stopping managed containers from the CLI/menu
// QUOTE(ТЗ): "Могу удалить / Отключить"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> containers_stopped(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeDown = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["down"], [Number(ExitCode(0))])

// CHANGE: recreate docker compose environment in the target directory
// WHY: allow a clean rebuild of the container from the UI
// QUOTE(ТЗ): "дропнул контейнер и заново его создал"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall dir: down(dir) && up(dir) -> recreated(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: down completes before up starts
// COMPLEXITY: O(command)
export const runDockerComposeRecreate = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runDockerComposeDown(cwd),
    Effect.zipRight(runDockerComposeUp(cwd))
  )

// CHANGE: run docker compose ps in the target directory
// WHY: expose runtime status in the interactive menu
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> status_listed(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposePs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["ps"], [Number(ExitCode(0))])

// CHANGE: run docker compose logs in the target directory
// WHY: allow quick inspection of container output without leaving the menu
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) in {0,130} -> logs_shown(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeLogs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--tail", "200"], [Number(ExitCode(0)), 130])

// CHANGE: stream docker compose logs until interrupted
// WHY: allow synchronous clone flow to surface container output
// QUOTE(ТЗ): "должно работать синхронно отображая весь процесс"
// REF: user-request-2026-01-28
// SOURCE: n/a
// FORMAT THEOREM: forall dir: logs_follow(dir) -> stdout(stream)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeLogsFollow = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--follow", "--tail", "0"], [Number(ExitCode(0)), 130])

// CHANGE: run docker exec and return its exit code
// WHY: allow polling for clone completion markers inside the container
// QUOTE(ТЗ): "весь процесс от и до"
// REF: user-request-2026-01-28
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(docker exec cmd) = n -> deterministic(n)
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: stdout/stderr are suppressed for polling commands
// COMPLEXITY: O(command)
export const runDockerExecExitCode = (
  cwd: string,
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const command = pipe(
      Command.make("docker", "exec", containerName, ...args),
      Command.workingDirectory(cwd),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
    const exitCode = yield* _(Command.exitCode(command))
    return Number(exitCode)
  })
