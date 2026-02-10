import * as Chunk from "effect/Chunk"
import * as Data from "effect/Data"
import { Effect, pipe } from "effect"
import type { PlatformError } from "@effect/platform/Error"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as Stream from "effect/Stream"

export class PortCommandError extends Data.TaggedError("PortCommandError")<{
  readonly command: string
  readonly exitCode: number
}> {}

export class PortInUseError extends Data.TaggedError("PortInUseError")<{
  readonly port: number
  readonly pids: ReadonlyArray<number>
}> {}

const collectUint8Array = (chunks: Chunk.Chunk<Uint8Array>): Uint8Array =>
  Chunk.reduce(chunks, new Uint8Array(), (acc, curr) => {
    const next = new Uint8Array(acc.length + curr.length)
    next.set(acc)
    next.set(curr, acc.length)
    return next
  })

const runCommandCapture = (
  command: Command.Command,
  okExitCodes: ReadonlyArray<number>,
  label: string
): Effect.Effect<string, PortCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* (_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const process = yield* _(executor.start(command))
      const bytes = yield* _(pipe(process.stdout, Stream.runCollect, Effect.map(collectUint8Array)))
      const exitCode = yield* _(process.exitCode)
      const numericExitCode = Number(exitCode)
      if (!okExitCodes.includes(numericExitCode)) {
        return yield* _(
          Effect.fail(new PortCommandError({ command: label, exitCode: numericExitCode }))
        )
      }
      return new TextDecoder("utf-8").decode(bytes)
    })
  )

const parsePidsForPort = (output: string, port: number): ReadonlyArray<number> => {
  const matches = output
    .split("\n")
    .filter((line) => line.includes(`:${port}`))
    .flatMap((line) => [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])))
    .filter((pid) => Number.isFinite(pid))
  return Array.from(new Set(matches))
}

const readListeningPids = (
  port: number
): Effect.Effect<
  ReadonlyArray<number>,
  PortCommandError | PlatformError,
  CommandExecutor.CommandExecutor
> => {
  const command = pipe(Command.make("ss", "-ltnp"), Command.stdout("pipe"), Command.stderr("pipe"))
  return runCommandCapture(command, [0], "ss -ltnp").pipe(
    Effect.map((output) => parsePidsForPort(output, port))
  )
}

const readProcessCommand = (
  pid: number
): Effect.Effect<string, PortCommandError | PlatformError, CommandExecutor.CommandExecutor> => {
  const command = pipe(
    Command.make("ps", "-p", String(pid), "-o", "cmd="),
    Command.stdout("pipe"),
    Command.stderr("pipe")
  )
  return runCommandCapture(command, [0, 1], "ps")
}

const readProcessCwd = (
  pid: number
): Effect.Effect<string | null, PortCommandError | PlatformError, CommandExecutor.CommandExecutor> => {
  const command = pipe(
    Command.make("pwdx", String(pid)),
    Command.stdout("pipe"),
    Command.stderr("pipe")
  )
  return runCommandCapture(command, [0, 1], "pwdx").pipe(
    Effect.map((output) => {
      const trimmed = output.trim()
      if (trimmed.length === 0) {
        return null
      }
      const parts = trimmed.split(":")
      return parts.length > 1 ? parts.slice(1).join(":").trim() : null
    })
  )
}

const killProcess = (
  pid: number
): Effect.Effect<void, PortCommandError | PlatformError, CommandExecutor.CommandExecutor> => {
  const command = pipe(Command.make("kill", String(pid)), Command.stdout("pipe"), Command.stderr("pipe"))
  return runCommandCapture(command, [0, 1], "kill").pipe(Effect.asVoid)
}

const isDockerGitServerProcess = (
  command: string,
  serverCwd: string,
  processCwd: string | null
): boolean => {
  const normalized = command.trim().toLowerCase()
  if (normalized.length === 0) {
    return false
  }
  if (
    normalized.includes("docker-git") &&
    (normalized.includes("dist/server/main.js") ||
      normalized.includes("start:server") ||
      normalized.includes("docker-git start:server"))
  ) {
    return true
  }
  if (!normalized.includes("dist/server/main.js")) {
    return false
  }
  if (!processCwd || processCwd.trim().length === 0) {
    return false
  }
  return processCwd === serverCwd
}

const releasePort = (
  port: number,
  serverCwd: string
): Effect.Effect<void, PortInUseError | PortCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* (_) {
    const pids = yield* _(readListeningPids(port))
    if (pids.length === 0) {
      return
    }

    for (const pid of pids) {
      const command = yield* _(readProcessCommand(pid))
      const processCwd = yield* _(readProcessCwd(pid))
      if (isDockerGitServerProcess(command, serverCwd, processCwd)) {
        yield* _(killProcess(pid))
      }
    }

    const remaining = yield* _(readListeningPids(port))
    if (remaining.length > 0) {
      yield* _(Effect.fail(new PortInUseError({ port, pids: remaining })))
    }
  })

// CHANGE: ensure docker-git ports are free before binding the HTTP/WS servers
// WHY: prevent EADDRINUSE when a previous server instance is still running
// QUOTE(ТЗ): "Почему процессы сами по себе не убиваются?"
// REF: user-request-2026-01-10
// SOURCE: n/a
// FORMAT THEOREM: forall p in ports: free(p) -> bind(p)
// PURITY: SHELL
// EFFECT: Effect<void, PortInUseError | PlatformError, CommandExecutor>
// INVARIANT: only docker-git server processes are terminated
// COMPLEXITY: O(n) where n = |ports|
export const ensurePortsFree = (
  ports: ReadonlyArray<number>,
  serverCwd: string
): Effect.Effect<
  void,
  PortInUseError | PortCommandError | PlatformError,
  CommandExecutor.CommandExecutor
> =>
  Effect.forEach(ports, (port) => releasePort(port, serverCwd), { concurrency: 1 }).pipe(
    Effect.asVoid
  )
