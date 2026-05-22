import { Effect } from "effect"

import { composeFilesForMode, resolveControllerComposeFiles } from "./controller-compose.js"
import { type ControllerRuntime, runDockerCapture } from "./controller-docker.js"
import { parseControllerRevisionLabelOutput } from "./controller-revision.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const inspectControllerRevisionLabelTemplate = String
  .raw`{{ index .Config.Labels "io.prover-coder-ai.docker-git.controller-rev" }}`

/**
 * Builds a typed controller bootstrap error.
 *
 * @param message - Human-readable bootstrap failure message.
 * @returns Controller bootstrap error value.
 *
 * @pure true
 * @effect n/a
 * @invariant Returned error tag is always `ControllerBootstrapError`.
 * @precondition `message` is a finite string.
 * @postcondition The returned error preserves the provided message.
 * @complexity O(1) time and O(1) space.
 * @throws Never
 */
// CHANGE: represent deterministic image-resolution failures as typed bootstrap errors
// WHY: ambiguous compose image output must fail through the Effect error channel
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: error(message).message = message
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: error tag is stable
// COMPLEXITY: O(1)
const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

/**
 * Returns all non-empty lines from Docker CLI output.
 *
 * @param output - Raw command output.
 * @returns Trimmed non-empty output lines.
 *
 * @pure true
 * @effect n/a
 * @invariant Every returned line has length > 0.
 * @precondition `output` is a finite string.
 * @postcondition Whitespace-only lines are ignored.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never
 */
// CHANGE: normalize compose image output before image inspection
// WHY: docker compose config --images emits line-oriented output and bootstrap needs a deterministic image proof
// QUOTE(ТЗ): "контейнер собирается минут 5-6"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: result = map(trim, lines(output)) filtered by non-empty
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: every result entry is non-empty
// COMPLEXITY: O(n)
const nonEmptyLines = (output: string): ReadonlyArray<string> => {
  const lines = output.split(/\r?\n/u)
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Resolves compose image output into exactly one controller image name.
 *
 * @param output - Raw `docker compose config --images` output.
 * @returns Effect with the single image, null for empty output, or a typed bootstrap error for ambiguity.
 *
 * @pure true
 * @effect Effect.succeed | Effect.fail
 * @invariant More than one non-empty line is rejected as ambiguous.
 * @precondition `output` is finite Docker CLI output.
 * @postcondition Success with a string implies exactly one non-empty image line existed.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never - ambiguity is represented in the Effect error channel.
 */
// CHANGE: require deterministic controller image resolution from compose output
// WHY: revision reuse is sound only when the inspected image is uniquely the controller image
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: |images| = 0 -> null, |images| = 1 -> images[0], |images| > 1 -> error
// PURITY: CORE
// EFFECT: Effect<string | null, ControllerBootstrapError>
// INVARIANT: multiple compose images never collapse to the first image
// COMPLEXITY: O(n) where n = |output|
const resolveSingleControllerImageName = (
  output: string
): Effect.Effect<string | null, ControllerBootstrapError> => {
  const imageNames = nonEmptyLines(output)
  if (imageNames.length === 0) {
    return Effect.succeed(null)
  }
  const imageName = imageNames[0]
  if (imageNames.length === 1 && imageName !== undefined) {
    return Effect.succeed(imageName)
  }
  return Effect.fail(
    controllerBootstrapError(
      [
        "Expected exactly one docker-git controller image from docker compose config --images.",
        "Resolved images:",
        ...imageNames.map((name) => `- ${name}`)
      ].join("\n")
    )
  )
}

/**
 * Resolves the Docker image name configured for the active controller compose files.
 *
 * @returns The single compose image name, or null when compose emits no images.
 *
 * @pure false
 * @effect Docker CLI through ControllerRuntime.
 * @invariant Multiple compose images fail rather than selecting the first line.
 * @precondition Compose files resolve for the current GPU mode.
 * @postcondition Returned image name is trimmed and non-empty.
 * @complexity O(1) compose invocations.
 * @throws Never - failures are represented in the Effect error channel.
 */
// CHANGE: resolve the compose-built controller image before comparing revisions
// WHY: avoiding --build is sound only when the selected image already carries the local revision label
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: |compose_images| <= 1 or bootstrap fails
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: ambiguous image lists are typed bootstrap errors
// COMPLEXITY: O(1) Docker compose invocations
const inspectControllerComposeImageName = (): Effect.Effect<
  string | null,
  ControllerBootstrapError,
  ControllerRuntime
> =>
  Effect.gen(function*(_) {
    const composeFiles = yield* _(resolveControllerComposeFiles())
    const output = yield* _(
      runDockerCapture(
        [
          "compose",
          ...composeFilesForMode(composeFiles.composePath, composeFiles.gpuOverlayPath),
          "config",
          "--images"
        ],
        "Failed to resolve docker-git controller image"
      )
    )

    return yield* _(resolveSingleControllerImageName(output))
  })

/**
 * Reads the revision label from the image resolved by the active compose files.
 *
 * @returns Current image revision, or null when the image/label is missing.
 *
 * @pure false
 * @effect Docker CLI through ControllerRuntime.
 * @invariant Missing or ambiguous compose image output resolves to null rather than throwing.
 * @precondition Docker is reachable through the configured runtime.
 * @postcondition Returned revision is normalized by label parsing.
 * @complexity O(1) Docker inspections.
 * @throws Never - failures are represented in the Effect error channel or recovered to null.
 */
// CHANGE: inspect the compose-built controller image revision label
// WHY: host bootstrap can start an already-current image without forcing Docker to rebuild heavy layers
// QUOTE(ТЗ): "контейнер собирается минут 5-6"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: image_label(image) = local_revision -> no rebuild is required
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: missing or unresolvable image metadata resolves to null rather than throwing
// COMPLEXITY: O(1) Docker inspections
export const inspectControllerImageRevision = (): Effect.Effect<
  string | null,
  ControllerBootstrapError,
  ControllerRuntime
> =>
  inspectControllerComposeImageName().pipe(
    Effect.orElseSucceed((): string | null => null),
    Effect.flatMap((imageName) =>
      imageName === null
        ? Effect.succeed<string | null>(null)
        : runDockerCapture(
          ["image", "inspect", "-f", inspectControllerRevisionLabelTemplate, imageName],
          `Failed to inspect image revision for ${imageName}`
        ).pipe(
          Effect.map((output) => parseControllerRevisionLabelOutput(output)),
          Effect.orElseSucceed((): string | null => null)
        )
    )
  )
