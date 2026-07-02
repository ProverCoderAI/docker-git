import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { type ControllerBootstrapError, controllerBootstrapError } from "./host-errors.js"

export const controllerGpuModeEnvKey = "DOCKER_GIT_CONTROLLER_GPU"
export const controllerComposeExtraFileEnvKey = "DOCKER_GIT_CONTROLLER_COMPOSE_EXTRA_FILE"

export type ControllerGpuMode = "none" | "all"

export type ControllerComposeFiles = {
  readonly composePath: string
  readonly extraOverlayPath: string | null
  readonly gpuOverlayPath: string | null
  readonly runtimeOverlayPath: string | null
}

const mapComposePathError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to resolve docker-compose.yml path.\nDetails: ${String(error)}`)

// CHANGE: add a verified controller compose overlay boundary for E2E/runtime callers
// WHY: temporary compose overrides must be part of the explicit docker compose argument vector
// QUOTE(ТЗ): n/a
// REF: issue-440-review-compose-overlay
// SOURCE: n/a
// FORMAT THEOREM: forall p: env(extra)=p and regular_file(resolve(p)) -> resolve(extra)=Some(resolve(p))
// PURITY: SHELL
// EFFECT: Effect<string | null, ControllerBootstrapError, FileSystem | Path>
// INVARIANT: non-empty extra compose env values either resolve to a regular file or fail before docker compose
// COMPLEXITY: O(1)
export const loadControllerComposeExtraPath = (): Effect.Effect<
  string | null,
  ControllerBootstrapError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const raw = process.env[controllerComposeExtraFileEnvKey]?.trim() ?? ""
    if (raw.length === 0) {
      return null
    }

    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const extraOverlayPath = path.resolve(raw)
    const isExists = yield* _(fs.exists(extraOverlayPath).pipe(Effect.mapError(mapComposePathError)))
    if (!isExists) {
      return yield* _(
        Effect.fail(
          controllerBootstrapError(
            `${controllerComposeExtraFileEnvKey} points to ${extraOverlayPath}, but it was not found.`
          )
        )
      )
    }

    const info = yield* _(fs.stat(extraOverlayPath).pipe(Effect.mapError(mapComposePathError)))
    return info.type === "File"
      ? extraOverlayPath
      : yield* _(
        Effect.fail(
          controllerBootstrapError(
            `${controllerComposeExtraFileEnvKey} points to ${extraOverlayPath}, but it is not a regular file.`
          )
        )
      )
  })

export const composeFilesForMode = (
  composePath: string,
  gpuOverlayPath: string | null,
  runtimeOverlayPath: string | null = null,
  extraOverlayPath: string | null = null
): ReadonlyArray<string> => [
  "-f",
  composePath,
  ...(runtimeOverlayPath === null ? [] : ["-f", runtimeOverlayPath]),
  ...(gpuOverlayPath === null ? [] : ["-f", gpuOverlayPath]),
  ...(extraOverlayPath === null ? [] : ["-f", extraOverlayPath])
]

export const composeFilesToArgs = (composeFiles: ControllerComposeFiles): ReadonlyArray<string> =>
  composeFilesForMode(
    composeFiles.composePath,
    composeFiles.gpuOverlayPath,
    composeFiles.runtimeOverlayPath,
    composeFiles.extraOverlayPath
  )

// CHANGE: require the GPU compose overlay path to be a regular file
// WHY: docker compose accepts file arguments; accepting directories delays the failure past typed bootstrap validation
// QUOTE(ТЗ): "Исправь CI/CD и все правки от Rabbit Coder."
// REF: PR-440-CodeRabbit-f31ac99d
// SOURCE: n/a
// FORMAT THEOREM: forall p: gpu=all and regular_file(resolve(p)) -> resolve(gpu)=Some(resolve(p))
// PURITY: SHELL
// EFFECT: Effect<string, ControllerBootstrapError, FileSystem | Path>
// INVARIANT: GPU compose overlay resolution returns only existing regular files
// COMPLEXITY: O(1)
const requireGpuOverlayPath = (
  composePath: string
): Effect.Effect<string, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const gpuOverlayPath = path.join(path.dirname(composePath), "docker-compose.gpu.yml")
    const isExists = yield* _(fs.exists(gpuOverlayPath).pipe(Effect.mapError(mapComposePathError)))
    if (!isExists) {
      return yield* _(
        Effect.fail(
          controllerBootstrapError(`${controllerGpuModeEnvKey}=all requires ${gpuOverlayPath}, but it was not found.`)
        )
      )
    }

    const info = yield* _(fs.stat(gpuOverlayPath).pipe(Effect.mapError(mapComposePathError)))
    return info.type === "File"
      ? gpuOverlayPath
      : yield* _(
        Effect.fail(
          controllerBootstrapError(
            `${controllerGpuModeEnvKey}=all requires ${gpuOverlayPath}, but it is not a regular file.`
          )
        )
      )
  })

export const composeFilesForGpuMode = (
  composePath: string,
  gpuMode: ControllerGpuMode
): Effect.Effect<ControllerComposeFiles, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  gpuMode === "none"
    ? Effect.succeed({ composePath, extraOverlayPath: null, gpuOverlayPath: null, runtimeOverlayPath: null })
    : requireGpuOverlayPath(composePath).pipe(
      Effect.map((gpuOverlayPath) => ({
        composePath,
        extraOverlayPath: null,
        gpuOverlayPath,
        runtimeOverlayPath: null
      }))
    )
