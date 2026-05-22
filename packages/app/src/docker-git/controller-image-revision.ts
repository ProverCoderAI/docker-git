import { Effect } from "effect"

import { composeFilesForMode, resolveControllerComposeFiles } from "./controller-compose.js"
import { type ControllerRuntime, runDockerCapture } from "./controller-docker.js"
import { parseControllerRevisionLabelOutput } from "./controller-revision.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const inspectControllerRevisionLabelTemplate = String
  .raw`{{ index .Config.Labels "io.prover-coder-ai.docker-git.controller-rev" }}`

/**
 * Returns the first non-empty line from Docker CLI output.
 *
 * @param output - Raw command output.
 * @returns The first trimmed non-empty line, or null when none exists.
 *
 * @pure true
 * @effect n/a
 * @invariant Result is either null or a string with length > 0.
 * @precondition `output` is a finite string.
 * @postcondition Whitespace-only lines are ignored.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never
 */
// CHANGE: normalize compose image output before image inspection
// WHY: docker compose config --images emits line-oriented output and bootstrap needs one image name proof
// QUOTE(ТЗ): "контейнер собирается минут 5-6"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: exists first non-empty line -> result = trim(first)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: result is null or non-empty
// COMPLEXITY: O(n)
const firstNonEmptyLine = (output: string): string | null => {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return null
}

/**
 * Resolves the Docker image name configured for the active controller compose files.
 *
 * @returns The first compose image name, or null when compose emits no images.
 *
 * @pure false
 * @effect Docker CLI through ControllerRuntime.
 * @invariant Empty compose output is represented as null.
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
// FORMAT THEOREM: compose_image = null -> image_revision = null
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: no image name is treated as missing revision proof
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

    return firstNonEmptyLine(output)
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
