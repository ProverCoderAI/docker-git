import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect } from "effect"

import {
  type ControllerComposeFiles,
  type ControllerGpuMode,
  composeFilesForGpuMode,
  controllerGpuModeEnvKey,
  loadControllerComposeExtraPath
} from "./controller-compose-files.js"
import { loadControllerDockerRuntime, resolveControllerRuntimeOverlayPath } from "./controller-compose-runtime.js"
import { computeLocalControllerRevision, controllerRevisionEnvKey } from "./controller-revision.js"
import type { ControllerDockerRuntime } from "./controller-runtime.js"
import { runCommandWithCapturedOutput } from "./frontend-lib/shell/command-runner.js"
import { findExistingUpwards } from "./frontend-lib/usecases/path-helpers.js"
import { type ControllerBootstrapError, controllerBootstrapError } from "./host-errors.js"

export const controllerBuildSkillerEnvKey = "DOCKER_GIT_CONTROLLER_BUILD_SKILLER"

export type ControllerBuildSkillerMode = "0" | "1"

export {
  composeFilesForMode,
  composeFilesToArgs,
  controllerComposeExtraFileEnvKey,
  controllerGpuModeEnvKey
} from "./controller-compose-files.js"
export type { ControllerComposeFiles, ControllerGpuMode } from "./controller-compose-files.js"

export const controllerComposeProjectName = "docker-git"

// CHANGE: pin the controller compose project name across checkout directories
// WHY: fixed controller container_name must be recreated by the same compose project, not by cwd-derived names
// QUOTE(ТЗ): "container name \"/docker-git-api\" is already in use"
// REF: user-message-2026-06-06-controller-compose-conflict
// SOURCE: n/a
// FORMAT THEOREM: forall cwd: compose_project(controller_bootstrap(cwd)) = "docker-git"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: controller bootstrap compose commands use one global project name
// COMPLEXITY: O(1)
export const controllerComposeProjectArgs: ReadonlyArray<string> = [
  "--project-name",
  controllerComposeProjectName
]

const skillerSubmodulePath = "third_party/skiller-desktop-skills-manager"
const skillerPackagePath = `${skillerSubmodulePath}/package.json`

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
  buildSkillerMode: ControllerBuildSkillerMode = "1",
  dockerRuntime: ControllerDockerRuntime = "host"
): string => `${sourceRevision}-${dockerRuntime}-${gpuMode}-skiller${buildSkillerMode}`

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

const mapSkillerPathError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to check Skiller submodule path.\nDetails: ${String(error)}`)

const mapControllerRevisionError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to compute docker-git controller revision.\nDetails: ${String(error)}`)

const skillerSubmoduleCommand = [
  "submodule",
  "update",
  "--init",
  "--checkout",
  skillerSubmodulePath
]
const skillerSubmoduleInitTimeout = Duration.seconds(60)

const formatSkillerSubmoduleFailure = (rootDir: string, exitCode: number, output: string): ControllerBootstrapError =>
  controllerBootstrapError(
    [
      "Failed to initialize Skiller submodule before building docker-git controller.",
      `Command: git ${skillerSubmoduleCommand.join(" ")}`,
      `Working directory: ${rootDir}`,
      `Exit code: ${exitCode}`,
      output.trim().length > 0 ? `Output:\n${output.trim()}` : "Output: n/a"
    ].join("\n")
  )

const runSkillerSubmoduleInit = (
  rootDir: string
): Effect.Effect<void, ControllerBootstrapError, CommandExecutor.CommandExecutor> =>
  runCommandWithCapturedOutput(
    {
      cwd: rootDir,
      command: "git",
      args: skillerSubmoduleCommand
    },
    [0],
    (exitCode, output) => formatSkillerSubmoduleFailure(rootDir, exitCode, output)
  ).pipe(
    Effect.timeoutFail({
      duration: skillerSubmoduleInitTimeout,
      onTimeout: () =>
        controllerBootstrapError(
          [
            "Timed out while initializing Skiller submodule before building docker-git controller.",
            `Command: git ${skillerSubmoduleCommand.join(" ")}`,
            `Working directory: ${rootDir}`,
            `Timeout: ${Duration.toSeconds(skillerSubmoduleInitTimeout)} seconds`
          ].join("\n")
        )
    }),
    Effect.mapError((error): ControllerBootstrapError =>
      error._tag === "ControllerBootstrapError"
        ? error
        : controllerBootstrapError(
          `Failed to initialize Skiller submodule before building docker-git controller.\nDetails: ${String(error)}`
        )
    )
  )

// CHANGE: initialize the pinned Skiller submodule before controller Docker builds
// WHY: the API image copies `third_party`, so an empty submodule makes the patch/build step fail
// QUOTE(ТЗ): "исправь проблему"
// REF: user-message-2026-05-24-controller-skiller-submodule
// SOURCE: n/a
// FORMAT THEOREM: forall root: missing(root/skillerPackagePath) -> init(root) -> exists(root/skillerPackagePath) or typed error
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError, FileSystem | Path | CommandExecutor>
// INVARIANT: controller revision and Docker build context are computed only after Skiller source exists
// COMPLEXITY: O(1) filesystem probes plus O(git submodule update)
export const ensureSkillerSubmoduleInitialized = (
  rootDir: string
): Effect.Effect<void, ControllerBootstrapError, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const packagePath = path.join(rootDir, skillerPackagePath)
    const isExistsBeforeInit = yield* _(fs.exists(packagePath).pipe(Effect.mapError(mapSkillerPathError)))
    if (isExistsBeforeInit) {
      return
    }

    yield* _(Effect.log("Initializing Skiller submodule for docker-git controller build."))
    yield* _(runSkillerSubmoduleInit(rootDir))

    const isExistsAfterInit = yield* _(fs.exists(packagePath).pipe(Effect.mapError(mapSkillerPathError)))
    if (isExistsAfterInit) {
      return
    }

    return yield* _(
      Effect.fail(
        controllerBootstrapError(
          `Skiller submodule initialization completed but ${packagePath} was not found.`
        )
      )
    )
  })

type ComposePathAndGpuMode = {
  readonly composePath: string
  readonly dockerRuntime: ControllerDockerRuntime
  readonly gpuMode: ControllerGpuMode
  readonly buildSkillerMode: ControllerBuildSkillerMode
}

const withComposePathAndGpuMode = <A, R>(
  effect: (input: ComposePathAndGpuMode) => Effect.Effect<
    A,
    ControllerBootstrapError,
    R
  >
): Effect.Effect<A, ControllerBootstrapError, FileSystem.FileSystem | Path.Path | R> =>
  composeFilePath().pipe(
    Effect.mapError(mapComposePathError),
    Effect.flatMap((composePath) =>
      Effect.all({
        buildSkillerMode: loadControllerBuildSkillerMode(),
        dockerRuntime: loadControllerDockerRuntime(),
        gpuMode: loadControllerGpuMode()
      }).pipe(
        Effect.flatMap((modes) => effect({ composePath, ...modes }))
      )
    )
  )

export const resolveControllerComposeFiles = (): Effect.Effect<
  ControllerComposeFiles,
  ControllerBootstrapError,
  FileSystem.FileSystem | Path.Path
> =>
  withComposePathAndGpuMode(({ composePath, dockerRuntime, gpuMode }) =>
    Effect.gen(function*(_) {
      const composeFiles = yield* _(composeFilesForGpuMode(composePath, gpuMode))
      const extraOverlayPath = yield* _(loadControllerComposeExtraPath())
      const runtimeOverlayPath = yield* _(resolveControllerRuntimeOverlayPath(composePath, dockerRuntime))
      return { ...composeFiles, extraOverlayPath, runtimeOverlayPath }
    })
  )

const computeControllerRevision = (
  composePath: string,
  gpuMode: ControllerGpuMode,
  buildSkillerMode: ControllerBuildSkillerMode,
  dockerRuntime: ControllerDockerRuntime
): Effect.Effect<string, ControllerBootstrapError, FileSystem.FileSystem | Path.Path> =>
  computeLocalControllerRevision(composePath).pipe(
    Effect.mapError(mapControllerRevisionError),
    Effect.map((revision) => controllerRevisionForMode(revision, gpuMode, buildSkillerMode, dockerRuntime))
  )

const persistControllerRevision = (revision: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.env[controllerRevisionEnvKey] = revision
  })

export const prepareControllerRevision = (): Effect.Effect<
  string,
  ControllerBootstrapError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  withComposePathAndGpuMode(({ buildSkillerMode, composePath, dockerRuntime, gpuMode }) =>
    Effect.gen(function*(_) {
      const path = yield* _(Path.Path)
      if (buildSkillerMode === "1") {
        yield* _(ensureSkillerSubmoduleInitialized(path.dirname(composePath)))
      }
      return yield* _(computeControllerRevision(composePath, gpuMode, buildSkillerMode, dockerRuntime))
    })
  ).pipe(
    Effect.tap((revision) => persistControllerRevision(revision))
  )
