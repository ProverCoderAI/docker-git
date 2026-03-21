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
  readonly env?: Readonly<Record<string, string | undefined>>
}

const buildCommand = (
  spec: RunCommandSpec,
  stdout: "inherit" | "pipe",
  stderr: "inherit" | "pipe",
  stdin: Command.CommandInput = "pipe"
) =>
  pipe(
    Command.make(spec.command, ...spec.args),
    Command.workingDirectory(spec.cwd),
    spec.env ? Command.env(spec.env) : (value) => value,
    Command.stdin(stdin),
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
    const exitCode = yield* _(Command.exitCode(buildCommand(spec, "inherit", "inherit", "inherit")))
    const numericExitCode = Number(exitCode)
    yield* _(ensureExitCode(numericExitCode, okExitCodes, onFailure))
  })

// CHANGE: run a command and return the exit code, draining stdout/stderr to prevent buffer deadlock
// WHY: piped stdout/stderr fill the OS buffer (~64 KB) causing the child process to hang indefinitely
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) = n
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: stdout/stderr are drained asynchronously so the child process never blocks
// COMPLEXITY: O(command)
export const runCommandExitCode = (
  spec: RunCommandSpec
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(buildCommand(spec, "pipe", "pipe", "pipe")))
      yield* _(Effect.forkDaemon(Stream.runDrain(process.stdout)))
      yield* _(Effect.forkDaemon(Stream.runDrain(process.stderr)))
      const exitCode = yield* _(process.exitCode)
      return Number(exitCode)
    })
  )

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

// CHANGE: run a command and capture stdout, draining stderr to prevent buffer deadlock
// WHY: if stderr fills the OS buffer (~64 KB) the child process hangs; drain it asynchronously
// QUOTE(ТЗ): "система авторизации"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: capture(cmd) -> stdout(cmd)
// PURITY: SHELL
// EFFECT: Effect<string, E | PlatformError, CommandExecutor>
// INVARIANT: stderr is drained asynchronously; stdout is fully collected before returning
// COMPLEXITY: O(command)
export const runCommandCapture = <E>(
  spec: RunCommandSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<string, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(buildCommand(spec, "pipe", "pipe", "pipe")))
      yield* _(Effect.forkDaemon(Stream.runDrain(process.stderr)))
      const bytes = yield* _(
        pipe(process.stdout, Stream.runCollect, Effect.map((chunks) => collectUint8Array(chunks)))
      )
      const exitCode = yield* _(process.exitCode)
      const numericExitCode = Number(exitCode)
      yield* _(ensureExitCode(numericExitCode, okExitCodes, onFailure))
      return new TextDecoder("utf-8").decode(bytes)
    })
  )
