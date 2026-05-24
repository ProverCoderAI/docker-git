import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"
import * as fc from "fast-check"

import { inspectControllerImageRevision } from "../../src/docker-git/controller-image-revision.js"
import type { ControllerBootstrapError } from "../../src/docker-git/host-errors.js"
import {
  commandExecutorLayer,
  emptyCommandResult,
  type TestCommandHandler,
  type TestCommandResult
} from "./fixtures/command-executor.js"

const composeImageLineArbitrary = fc
  .string({ minLength: 1 })
  .filter((value) => value.trim().length > 0 && !value.includes("\n") && !value.includes("\r"))
const nonReusableComposeImagesOutputArbitrary = fc.oneof(
  fc.constantFrom("", "\n", " \n\t\n"),
  fc.array(composeImageLineArbitrary, { maxLength: 8, minLength: 2 }).map((lines) =>
    lines.map((line) => ` ${line} `).join("\n")
  )
)

/**
 * Runs image revision inspection with a controlled command handler.
 *
 * @param handler - Total fake command handler.
 * @returns Effect producing the inspected image revision.
 * @pure false
 * @effect CommandExecutor, FileSystem, Path
 * @invariant Docker commands are served by the in-memory command executor.
 * @precondition `handler` is total for the commands emitted by image revision inspection.
 * @postcondition The real Docker daemon is never invoked.
 * @complexity O(1) excluding handler cost.
 * @throws Never - all command failures are represented in the Effect error channel.
 */
// CHANGE: centralize the mocked image revision inspection shell boundary
// WHY: selective fallback behavior must be testable without the host Docker daemon
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: handler -> inspectControllerImageRevision(handler)
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: Docker command output is supplied by the test harness
// COMPLEXITY: O(1)
const inspectRevisionWithCommandHandler = (handler: TestCommandHandler) =>
  inspectControllerImageRevision().pipe(
    Effect.provide(commandExecutorLayer(handler)),
    Effect.provide(FileSystem.layerNoop({})),
    Effect.provide(Path.layer)
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
  inspectRevisionWithCommandHandler((command) =>
    command.command === "docker" && command.args.includes("--images")
      ? { exitCode: 0, stderr: "", stdout: composeImagesOutput }
      : emptyCommandResult
  )

/**
 * Builds a command handler for the single-compose-image inspection path.
 *
 * @param inspectResult - Fake `docker image inspect` result.
 * @returns Total command handler for the inspection scenario.
 * @pure true
 * @effect none
 * @invariant Compose image resolution always emits exactly one image line.
 * @precondition `inspectResult` is a finite fake process result.
 * @postcondition Image inspect commands receive `inspectResult`; other commands succeed empty.
 * @complexity O(1).
 * @throws Never
 */
// CHANGE: remove duplicated fake Docker flow setup from image revision tests
// WHY: every selective-fallback scenario shares the same single compose image precondition
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: image_inspect(command) -> inspectResult; compose_images(command) -> one_image
// PURITY: CORE
// EFFECT: none
// INVARIANT: the handler preserves the one-image precondition for every test
// COMPLEXITY: O(1)
const singleImageInspectCommandHandler = (inspectResult: TestCommandResult): TestCommandHandler => (command) => {
  if (command.command === "docker" && command.args.includes("--images")) {
    return { exitCode: 0, stderr: "", stdout: "app-api:latest\n" }
  }
  if (command.command === "docker" && command.args.includes("image") && command.args.includes("inspect")) {
    return inspectResult
  }
  return emptyCommandResult
}

/**
 * Asserts the successful image revision result.
 *
 * @param effect - Fully provided image revision inspection effect.
 * @param expected - Expected revision value.
 * @returns Assertion effect.
 * @pure false
 * @effect Vitest assertion inside Effect.
 * @invariant The assertion observes exactly one completed revision effect.
 * @precondition `effect` has no remaining service requirements.
 * @postcondition Test fails when the revision value differs from `expected`.
 * @complexity O(1).
 * @throws Never - assertion failures are handled by the test runner.
 */
// CHANGE: centralize repeated revision value assertions
// WHY: test duplicate detection treats identical Effect.map assertion blocks as repeated logic
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: effect -> expected_revision
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError>
// INVARIANT: revision equality is checked in one reusable assertion helper
// COMPLEXITY: O(1)
const expectRevisionValue = (
  effect: Effect.Effect<string | null, ControllerBootstrapError>,
  expected: string | null
): Effect.Effect<void, ControllerBootstrapError> =>
  effect.pipe(
    Effect.map((revision) => {
      expect(revision).toBe(expected)
    })
  )

/**
 * Asserts that image revision inspection fails with a diagnostic substring.
 *
 * @param effect - Fully provided image revision inspection effect.
 * @param expectedMessage - Required substring in the typed error message.
 * @returns Assertion effect.
 * @pure false
 * @effect Vitest assertion inside Effect.
 * @invariant The inspected error remains in the Effect error channel until `Effect.either`.
 * @precondition `effect` has no remaining service requirements.
 * @postcondition Test fails when the effect succeeds or the message is not preserved.
 * @complexity O(n) where n = |error.message|.
 * @throws Never - assertion failures are handled by the test runner.
 */
// CHANGE: centralize repeated typed-error preservation assertions
// WHY: Docker infrastructure failures must be proved distinct from nullable fallback paths
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: failure(effect) -> message_contains(expectedMessage)
// PURITY: SHELL
// EFFECT: Effect<void>
// INVARIANT: a successful effect never satisfies this assertion
// COMPLEXITY: O(n)
const expectRevisionFailureMessage = (
  effect: Effect.Effect<string | null, ControllerBootstrapError>,
  expectedMessage: string
): Effect.Effect<void> =>
  effect.pipe(
    Effect.either,
    Effect.map((result) => {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left.message).toContain(expectedMessage)
      }
    })
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

  it.effect("returns parsed image revision when the compose image has a revision label", () =>
    expectRevisionValue(
      inspectRevisionWithCommandHandler(
        singleImageInspectCommandHandler({ exitCode: 0, stderr: "", stdout: " rev123 \n" })
      ),
      "rev123"
    ))

  it.effect("falls back to null when the compose image revision label is missing", () =>
    expectRevisionValue(
      inspectRevisionWithCommandHandler(
        singleImageInspectCommandHandler({ exitCode: 0, stderr: "", stdout: "<no value>\n" })
      ),
      null
    ))

  it.effect("falls back to null when the compose image is missing", () =>
    expectRevisionValue(
      inspectRevisionWithCommandHandler(
        singleImageInspectCommandHandler({
          exitCode: 1,
          stderr: "Error response from daemon: No such image: app-api:latest\n",
          stdout: ""
        })
      ),
      null
    ))

  it.effect("preserves non-missing image inspection failures", () =>
    expectRevisionFailureMessage(
      inspectRevisionWithCommandHandler(
        singleImageInspectCommandHandler({
          exitCode: 1,
          stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
          stdout: ""
        })
      ),
      "Cannot connect to the Docker daemon"
    ))

  it.effect("preserves Docker access probe failures", () =>
    expectRevisionFailureMessage(
      inspectRevisionWithCommandHandler((command) => {
        if (command.command === "docker" && command.args.includes("info")) {
          return { exitCode: 1, stderr: "permission denied direct\n", stdout: "" }
        }
        if (command.command === "sudo" && command.args.includes("info")) {
          return { exitCode: 1, stderr: "sudo requires a password\n", stdout: "" }
        }
        return emptyCommandResult
      }),
      "Direct probe: exit=1; permission denied direct"
    ))
})
