import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"
import * as Chunk from "effect/Chunk"
import * as Stream from "effect/Stream"

type RunCommandSpec = {
  readonly cwd: string
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const buildCommand = (
  spec: RunCommandSpec,
  stdout: "inherit" | "pipe",
  stderr: "inherit" | "pipe"
) =>
  pipe(
    Command.make(spec.command, ...spec.args),
    Command.workingDirectory(spec.cwd),
    Command.stdout(stdout),
    Command.stderr(stderr)
  )

const ensureExitCode = <E>(
  exitCode: number,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<number, E> =>
  okExitCodes.includes(exitCode)
    ? Effect.succeed(exitCode)
    : Effect.fail(onFailure(exitCode))

export const runCommandWithExitCodes = <E>(
  spec: RunCommandSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<void, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const exitCode = yield* _(Command.exitCode(buildCommand(spec, "inherit", "inherit")))
    const numericExitCode = Number(exitCode)
    yield* _(ensureExitCode(numericExitCode, okExitCodes, onFailure))
  })

// CHANGE: run a command and return the exit code
// WHY: enable status checks without throwing on non-zero exits
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) = n
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: stdout/stderr are inherited
// COMPLEXITY: O(command)
export const runCommandExitCode = (
  spec: RunCommandSpec
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.map(
    Command.exitCode(
      buildCommand(spec, "inherit", "inherit")
    ),
    Number
  )

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

// CHANGE: run a command and capture stdout
// WHY: allow auth flows to retrieve tokens from CLI tools
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: capture(cmd) -> stdout(cmd)
// PURITY: SHELL
// EFFECT: Effect<string, E | PlatformError, CommandExecutor>
// INVARIANT: stderr is captured but ignored for output
// COMPLEXITY: O(command)
export const runCommandCapture = <E>(
  spec: RunCommandSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<string, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(buildCommand(spec, "pipe", "pipe")))
      const bytes = yield* _(
        pipe(process.stdout, Stream.runCollect, Effect.map((chunks) => collectUint8Array(chunks)))
      )
      const exitCode = yield* _(process.exitCode)
      yield* _(ensureExitCode(Number(exitCode), okExitCodes, onFailure))
      return new TextDecoder("utf-8").decode(bytes)
    })
  )
