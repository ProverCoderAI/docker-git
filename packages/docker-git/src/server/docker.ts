import * as Chunk from "effect/Chunk"
import { Effect, pipe } from "effect"
import * as Stream from "effect/Stream"
import type { PlatformError } from "@effect/platform/Error"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"

import { DockerCommandError } from "../shell/errors.js"

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

const runCommandCapture = (
  command: Command.Command,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* (_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(command))
      const bytes = yield* _(pipe(process.stdout, Stream.runCollect, Effect.map(collectUint8Array)))
      const exitCode = yield* _(process.exitCode)
      const numericExitCode = Number(exitCode)

      if (!okExitCodes.includes(numericExitCode)) {
        return yield* _(Effect.fail(new DockerCommandError({ exitCode: numericExitCode })))
      }

      return new TextDecoder("utf-8").decode(bytes)
    })
  )

const runComposeCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> => {
  const command = pipe(
    Command.make("docker", "compose", ...args),
    Command.workingDirectory(cwd),
    Command.stdout("pipe"),
    Command.stderr("pipe")
  )

  return runCommandCapture(command, okExitCodes)
}

// CHANGE: capture docker compose ps output for UI display
// WHY: show container status in the web UI without shell access
// QUOTE(ТЗ): "видеть всю инфу по ним"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> ps_output(dir)
// PURITY: SHELL
// EFFECT: Effect<string, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: stdout captured for response
// COMPLEXITY: O(command)
export const readDockerComposePs = (
  cwd: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runComposeCapture(cwd, ["ps"], [0])

// CHANGE: capture docker compose logs output for UI display
// WHY: allow log inspection from the web UI
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) in {0,130} -> logs_output(dir)
// PURITY: SHELL
// EFFECT: Effect<string, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: stdout captured for response
// COMPLEXITY: O(command)
export const readDockerComposeLogs = (
  cwd: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runComposeCapture(cwd, ["logs", "--tail", "200"], [0, 130])
