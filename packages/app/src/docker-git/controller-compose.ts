import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { computeLocalControllerRevision, controllerRevisionEnvKey } from "./controller-revision.js"
import { findExistingUpwards } from "./frontend-lib/usecases/path-helpers.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export const controllerGpuModeEnvKey = "DOCKER_GIT_CONTROLLER_GPU"
export const controllerBuildSkillerEnvKey = "DOCKER_GIT_CONTROLLER_BUILD_SKILLER"

export type ControllerGpuMode = "none" | "all"
export type ControllerBuildSkillerMode = "0" | "1"

export type ControllerComposeFiles = {
  readonly composePath: string
  readonly gpuOverlayPath: string | null
}

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

export const parseControllerGpuMode = (raw?: string): ControllerGpuMode | null => {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0 || trimmed === "none") {
    return "none"
  }
  return trimmed === "all" ? "all" : null
}

export const parseControllerBuildSkillerMode = (raw?: string): ControllerBuildSkillerMode | null => {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0 || trimmed === "1" || trimmed === "true") {
    return "1"
  }
  return trimmed === "0" || trimmed === "false" ? "0" : null
}

export const controllerRevisionForMode = (
  sourceRevision: string,
  gpuMode: ControllerGpuMode,
  buildSkillerMode: ControllerBuildSkillerMode = "1"
): string => `${sourceRevision}-${gpuMode}-skiller${buildSkillerMode}`

const loadControllerGpuMode = (): Effect.Effect<ControllerGpuMode, ControllerBootstrapError> => {
  const raw = process.env[controllerGpuModeEnvKey]
  const parsed = parseControllerGpuMode(raw)
  if (parsed !== null) {
    return Effect.succeed(parsed)
  }
  return Effect.fail(
    controllerBootstrapError(
      `${controllerGpuModeEnvKey} must be unset or one of: none, all. Received: ${raw ?? ""}`
    )
  )
}

const loadControllerBuildSkillerMode = (): Effect.Effect<ControllerBuildSkillerMode, ControllerBootstrapError> => {
  const raw = process.env[controllerBuildSkillerEnvKey]
  const parsed = parseControllerBuildSkillerMode(raw)
  if (parsed !== null) {
    return Effect.succeed(parsed)
  }
  return Effect.fail(
    controllerBootstrapError(
      `${controllerBuildSkillerEnvKey} must be unset or one of: 0, 1, false, true. Received: ${raw ?? ""}`
    )
  )
}

const composeFilePath = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const found = yield* _(findExistingUpwards(fs, path, process.cwd(), "docker-compose.yml", 20))
    return found ?? path.resolve(process.cwd(), "docker-compose.yml")
  })

const mapComposePathError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to resolve docker-compose.yml path.\nDetails: ${String(error)}`)

const mapControllerRevisionError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to compute docker-git controller revision.\nDetails: ${String(error)}`)

export const composeFilesForMode = (
  composePath: string,
  gpuOverlayPath: string | null
): ReadonlyArray<string> =>
  gpuOverlayPath === null
    ? ["-f", composePath]
    : ["-f", composePath, "-f", gpuOverlayPath]

const requireGpuOverlayPath = (
  composePath: string
): Effect.Effect<string, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const gpuOverlayPath = path.join(path.dirname(composePath), "docker-compose.gpu.yml")
    const exists = yield* _(fs.exists(gpuOverlayPath).pipe(Effect.mapError(mapComposePathError)))
    return exists
      ? gpuOverlayPath
      : yield* _(
        Effect.fail(
          controllerBootstrapError(`${controllerGpuModeEnvKey}=all requires ${gpuOverlayPath}, but it was not found.`)
        )
      )
  })

const composeFilesForGpuMode = (
  composePath: string,
  gpuMode: ControllerGpuMode
): Effect.Effect<ControllerComposeFiles, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  gpuMode === "none"
    ? Effect.succeed({ composePath, gpuOverlayPath: null })
    : requireGpuOverlayPath(composePath).pipe(
      Effect.map((gpuOverlayPath) => ({ composePath, gpuOverlayPath }))
    )

type ComposePathAndGpuMode = {
  readonly composePath: string
  readonly gpuMode: ControllerGpuMode
  readonly buildSkillerMode: ControllerBuildSkillerMode
}

const withComposePathAndGpuMode = <A>(
  effect: (input: ComposePathAndGpuMode) => Effect.Effect<
    A,
    ControllerBootstrapError,
    FileSystem.FileSystem | Path.Path
  >
): Effect.Effect<A, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  composeFilePath().pipe(
    Effect.mapError(mapComposePathError),
    Effect.flatMap((composePath) =>
      loadControllerGpuMode().pipe(
        Effect.flatMap((gpuMode) =>
          loadControllerBuildSkillerMode().pipe(
            Effect.flatMap((buildSkillerMode) => effect({ buildSkillerMode, composePath, gpuMode }))
          )
        )
      )
    )
  )

export const resolveControllerComposeFiles = (): Effect.Effect<
  ControllerComposeFiles,
  ControllerBootstrapError,
  FileSystem.FileSystem | Path.Path
> => withComposePathAndGpuMode(({ composePath, gpuMode }) => composeFilesForGpuMode(composePath, gpuMode))

const computeControllerRevision = (
  composePath: string,
  gpuMode: ControllerGpuMode,
  buildSkillerMode: ControllerBuildSkillerMode
): Effect.Effect<string, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  computeLocalControllerRevision(composePath).pipe(
    Effect.mapError(mapControllerRevisionError),
    Effect.map((revision) => controllerRevisionForMode(revision, gpuMode, buildSkillerMode))
  )

const persistControllerRevision = (revision: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.env[controllerRevisionEnvKey] = revision
  })

export const prepareControllerRevision = (): Effect.Effect<
  string,
  ControllerBootstrapError,
  FileSystem.FileSystem | Path.Path
> =>
  withComposePathAndGpuMode(({ buildSkillerMode, composePath, gpuMode }) =>
    computeControllerRevision(composePath, gpuMode, buildSkillerMode)
  ).pipe(Effect.tap((revision) => persistControllerRevision(revision)))
