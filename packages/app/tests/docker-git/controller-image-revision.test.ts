import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as fc from "fast-check"

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
const composeImageLineArbitrary = fc
  .string({ minLength: 1 })
  .filter((value) => value.trim().length > 0 && !value.includes("\n") && !value.includes("\r"))
const nonReusableComposeImagesOutputArbitrary = fc.oneof(
  fc.constantFrom("", "\n", " \n\t\n"),
  fc.array(composeImageLineArbitrary, { maxLength: 8, minLength: 2 }).map((lines) =>
    lines.map((line) => ` ${line} `).join("\n")
  )
)

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

/**
 * Runs image revision inspection with controlled `docker compose config --images` output.
 *
 * @param composeImagesOutput - Stdout emitted by the fake `--images` command.
 * @returns Effect producing the inspected image revision.
 * @pure false
 * @effect CommandExecutor, FileSystem, Path
 * @invariant Docker commands are served by the in-memory command executor.
 * @precondition `composeImagesOutput` is finite text.
 * @postcondition The real Docker daemon is never invoked.
 * @complexity O(n) time and space where n = |composeImagesOutput|.
 * @throws Never - all command failures are represented in the Effect error channel.
 */
// CHANGE: centralize the mocked compose image inspection path for property tests
// WHY: the fallback invariant depends only on normalized compose stdout cardinality
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349246446
// SOURCE: n/a
// FORMAT THEOREM: output -> inspectControllerImageRevision(output)
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: Docker command output is supplied by the test harness
// COMPLEXITY: O(n)
const inspectRevisionWithComposeImagesOutput = (composeImagesOutput: string) =>
  inspectControllerImageRevision().pipe(
    Effect.provide(
      commandExecutorLayer((command) =>
        command.command === "docker" && command.args.includes("--images")
          ? { exitCode: 0, stderr: "", stdout: composeImagesOutput }
          : emptyCommandResult
      )
    ),
    Effect.provide(FileSystem.layerNoop({})),
    Effect.provide(Path.layer)
  )

describe("controller image revision", () => {
  it.effect("falls back to null for non-reusable compose image output cardinalities", () =>
    Effect.tryPromise({
      catch: (cause) => cause,
      try: () =>
        fc.assert(
          fc.asyncProperty(nonReusableComposeImagesOutputArbitrary, (composeImagesOutput) =>
            Effect.runPromise(
              Effect.gen(function*(_) {
                const revision = yield* _(inspectRevisionWithComposeImagesOutput(composeImagesOutput))
                expect(revision).toBeNull()
              })
            )),
          { numRuns: 50 }
        )
    }))
})
