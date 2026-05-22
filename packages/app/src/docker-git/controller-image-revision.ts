import { Effect } from "effect"

import { composeFilesForMode, resolveControllerComposeFiles } from "./controller-compose.js"
import { type ControllerRuntime, runDockerCapture } from "./controller-docker.js"
import { parseControllerRevisionLabelOutput } from "./controller-revision.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const inspectControllerRevisionLabelTemplate = String
  .raw`{{ index .Config.Labels "io.prover-coder-ai.docker-git.controller-rev" }}`

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
 * @returns The single image, or null for empty/ambiguous output.
 *
 * @pure true
 * @effect n/a
 * @invariant More than one non-empty line never collapses to the first image.
 * @precondition `output` is finite Docker CLI output.
 * @postcondition Success with a string implies exactly one non-empty image line existed.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never
 */
// CHANGE: require deterministic controller image resolution from compose output
// WHY: revision reuse is sound only when the inspected image is uniquely the controller image
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: |images| = 1 -> images[0], otherwise null
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: multiple compose images never collapse to the first image
// COMPLEXITY: O(n) where n = |output|
const resolveSingleControllerImageName = (output: string): string | null => {
  const imageNames = nonEmptyLines(output)
  const imageName = imageNames[0]
  return imageNames.length === 1 && imageName !== undefined ? imageName : null
}

/**
 * Resolves the Docker image name configured for the active controller compose files.
 *
 * @returns The single compose image name, or null when compose emits zero or multiple images.
 *
 * @pure false
 * @effect Docker CLI through ControllerRuntime.
 * @invariant Multiple compose images return null rather than selecting the first line.
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
// FORMAT THEOREM: |compose_images| = 1 -> image name, otherwise null
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: ambiguous image lists are not treated as reusable images
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

    return resolveSingleControllerImageName(output)
  })

/**
 * Reads the revision label from the image resolved by the active compose files.
 *
 * @returns Current image revision, or null when the image/label is missing.
 *
 * @pure false
 * @effect Docker CLI through ControllerRuntime.
 * @invariant Missing image or missing label resolves to null rather than throwing.
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
// INVARIANT: missing image or missing label resolves to null rather than throwing
// COMPLEXITY: O(1) Docker inspections
export const inspectControllerImageRevision = (): Effect.Effect<
  string | null,
  ControllerBootstrapError,
  ControllerRuntime
> =>
  inspectControllerComposeImageName().pipe(
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
