import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { inspectControllerImageRevision } from "../../src/docker-git/controller-image-revision.js"

type TestCommandResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

const emptyCommandResult: TestCommandResult = {
  exitCode: 0,
  stderr: "",
  stdout: ""
}

const encodeText = (value: string): Uint8Array => new TextEncoder().encode(value)

const textStream = (value: string) => value.length === 0 ? Stream.empty : Stream.succeed(encodeText(value))

/**
 * Builds a completed process for controller image revision shell tests.
 *
 * @param result - Command result emitted by the fake process.
 * @returns A completed Effect platform process.
 * @pure true
 * @effect none
 * @invariant The process is already stopped and its exit code is deterministic.
 * @precondition `result.stdout` and `result.stderr` are finite strings.
 * @postcondition Consumers observe exactly the provided stdout, stderr, and exit code.
 * @complexity O(n) time and O(n) space where n = |stdout| + |stderr|.
 * @throws Never
 */
// CHANGE: model Docker CLI process output without touching the host Docker daemon
// WHY: image revision fallback invariants must be unit-testable without external services
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349211730
// SOURCE: n/a
// FORMAT THEOREM: process(result).stdout = result.stdout and process(result).exit = result.exitCode
// PURITY: CORE
// EFFECT: none
// INVARIANT: fake process is not running after construction
// COMPLEXITY: O(n)
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

type TestCommandHandler = (command: Command.StandardCommand) => TestCommandResult

/**
 * Creates a command-executor layer backed by a pure command handler.
 *
 * @param handler - Total handler for standard commands.
 * @returns Layer providing CommandExecutor.
 * @pure true
 * @effect none
 * @invariant Every started command maps to exactly one completed fake process.
 * @precondition The handler is total for all commands issued by the test subject.
 * @postcondition Command effects never reach the real operating system.
 * @complexity O(1) layer construction.
 * @throws Never
 */
// CHANGE: provide typed Effect dependency injection for Docker command tests
// WHY: controller image revision inspection is a shell effect and must be tested through its service boundary
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349211730
// SOURCE: n/a
// FORMAT THEOREM: start(command) = completedProcess(handler(command))
// PURITY: SHELL
// EFFECT: Layer<CommandExecutor>
// INVARIANT: no command escapes the fake executor
// COMPLEXITY: O(1)
const commandExecutorLayer = (handler: TestCommandHandler) =>
  Layer.succeed(
    CommandExecutor.CommandExecutor,
    CommandExecutor.makeExecutor((command) => {
      const standardCommand = Command.flatten(command)[0]
      return Effect.succeed(completedProcess(handler(standardCommand)))
    })
  )

describe("controller image revision", () => {
  it.effect("falls back to null when compose image resolution is ambiguous", () =>
    Effect.gen(function*(_) {
      const revision = yield* _(
        inspectControllerImageRevision().pipe(
          Effect.provide(
            commandExecutorLayer((command) =>
              command.command === "docker" && command.args.includes("--images")
                ? { exitCode: 0, stderr: "", stdout: "app-api:latest\nanother-image:latest\n" }
                : emptyCommandResult
            )
          ),
          Effect.provide(FileSystem.layerNoop({})),
          Effect.provide(Path.layer)
        )
      )

      expect(revision).toBeNull()
    }))
})
