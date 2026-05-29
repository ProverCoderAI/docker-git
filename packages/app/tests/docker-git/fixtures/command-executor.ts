import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { Effect, Layer } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

export type TestCommandResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

export type TestCommandHandler = (command: Command.StandardCommand) => TestCommandResult

export const emptyCommandResult: TestCommandResult = {
  exitCode: 0,
  stderr: "",
  stdout: ""
}

const encodeText = (value: string): Uint8Array => new TextEncoder().encode(value)

const textStream = (value: string) => value.length === 0 ? Stream.empty : Stream.succeed(encodeText(value))

// CHANGE: model CLI process output without touching the host process table
// WHY: shell-boundary tests need deterministic CommandExecutor behavior
// QUOTE(TZ): "fix possible CI/CD and CodeRabbit complaints"
// REF: user-message-2026-05-24-coderabbit-ci
// SOURCE: n/a
// FORMAT THEOREM: process(result).stdout = result.stdout and process(result).stderr = result.stderr and process(result).exit = result.exitCode
// PURITY: CORE
// EFFECT: none
// INVARIANT: fake process is not running after construction
// COMPLEXITY: O(n) where n = |stdout| + |stderr|
const completedProcess = (result: TestCommandResult): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  [Inspectable.NodeInspectSymbol]: () => ({ _tag: "TestProcess" }),
  exitCode: Effect.succeed(CommandExecutor.ExitCode(result.exitCode)),
  isRunning: Effect.succeed(false),
  kill: () => Effect.void,
  pid: CommandExecutor.ProcessId(0),
  stderr: textStream(result.stderr),
  stdin: Sink.drain,
  stdout: textStream(result.stdout),
  toJSON: () => ({ _tag: "TestProcess" }),
  toString: () => "TestProcess"
})

// CHANGE: provide typed Effect dependency injection for command-shell tests
// WHY: tests must verify shell behavior without executing host commands
// QUOTE(TZ): "fix possible CI/CD and CodeRabbit complaints"
// REF: user-message-2026-05-24-coderabbit-ci
// SOURCE: n/a
// FORMAT THEOREM: start(command) = completedProcess(handler(flatten(command)))
// PURITY: SHELL
// EFFECT: Layer<CommandExecutor>
// INVARIANT: no command escapes the fake executor
// COMPLEXITY: O(1) excluding handler cost
export const commandExecutorLayer = (handler: TestCommandHandler) =>
  Layer.succeed(
    CommandExecutor.CommandExecutor,
    CommandExecutor.makeExecutor((command) => {
      const standardCommand = Command.flatten(command)[0]
      return Effect.succeed(completedProcess(handler(standardCommand)))
    })
  )
