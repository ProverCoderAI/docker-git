import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import {
  type ControllerDockerRuntime,
  controllerDockerRuntimeEnvKey,
  parseControllerDockerRuntime
} from "./controller-runtime.js"
import { type ControllerBootstrapError, controllerBootstrapError } from "./host-errors.js"

const mapComposePathError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to resolve docker-compose.yml path.\nDetails: ${String(error)}`)

export const loadControllerDockerRuntime = (): Effect.Effect<ControllerDockerRuntime, ControllerBootstrapError> => {
  const raw = process.env[controllerDockerRuntimeEnvKey]
  const parsed = parseControllerDockerRuntime(raw)
  if (parsed !== null) {
    return Effect.succeed(parsed)
  }
  return Effect.fail(
    controllerBootstrapError(
      `${controllerDockerRuntimeEnvKey} must be unset or one of: host, isolated. Received: ${raw ?? ""}`
    )
  )
}

const isolatedOverlayFileName = (composeFileName: string): string =>
  composeFileName.endsWith(".yaml")
    ? `${composeFileName.slice(0, -".yaml".length)}.isolated.yaml`
    : `${composeFileName.slice(0, -".yml".length)}.isolated.yml`

export const resolveControllerRuntimeOverlayPath = (
  composePath: string,
  dockerRuntime: ControllerDockerRuntime
): Effect.Effect<string | null, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  dockerRuntime === "host"
    ? Effect.succeed(null)
    : Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      const runtimeOverlayPath = path.join(
        path.dirname(composePath),
        isolatedOverlayFileName(path.basename(composePath))
      )
      const exists = yield* _(fs.exists(runtimeOverlayPath).pipe(Effect.mapError(mapComposePathError)))
      return exists
        ? runtimeOverlayPath
        : yield* _(
          Effect.fail(
            controllerBootstrapError(
              `${controllerDockerRuntimeEnvKey}=isolated requires ${runtimeOverlayPath}, but it was not found.`
            )
          )
        )
    })
