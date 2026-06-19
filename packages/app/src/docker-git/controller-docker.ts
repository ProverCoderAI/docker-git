import { Effect } from "effect"

import * as ControllerCompose from "./controller-compose.js"
import {
  buildDockerInvocation,
  type ControllerDockerCommandRuntime,
  formatDockerInvocationFailure,
  resolveDockerCommand,
  runDockerCapture,
  runDockerExitCodeCommand
} from "./controller-docker-command.js"
import { readCurrentContainerName } from "./controller-hostname.js"
import { type DockerNetworkIps, parseDockerNetworkIps, uniqueStrings } from "./controller-reachability.js"
import { parseControllerRevisionEnvOutput } from "./controller-revision.js"
import { runCommandExitCodeStreaming } from "./frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export {
  controllerBuildSkillerEnvKey,
  controllerGpuModeEnvKey,
  controllerRevisionForMode,
  parseControllerBuildSkillerMode,
  parseControllerGpuMode
} from "./controller-compose.js"
export { runDockerCapture, runDockerCaptureWithFailureOutput } from "./controller-docker-command.js"
export { parseControllerDockerRuntime } from "./controller-runtime.js"

export type ControllerRuntime = ControllerDockerCommandRuntime

export const controllerContainerName = process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || "docker-git-api"

const inspectNetworksTemplate = String
  .raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`
const inspectEnvTemplate = "{{range .Config.Env}}{{println .}}{{end}}"
const inspectStateRunningTemplate = "{{.State.Running}}"

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const currentProcessEnv = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )

const isDockerInspectBooleanOutputTrue = (output: string): boolean => output.trim().toLowerCase() === "true"

export const runCompose = (
  args: ReadonlyArray<string>
): Effect.Effect<void, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const dockerCommand = yield* _(resolveDockerCommand())
    const composeFiles = yield* _(ControllerCompose.resolveControllerComposeFiles())
    const invocation = buildDockerInvocation(dockerCommand, [
      "compose",
      ...ControllerCompose.controllerComposeProjectArgs,
      ...ControllerCompose.composeFilesToArgs(composeFiles),
      ...args
    ])
    const exitCode = yield* _(
      runCommandExitCodeStreaming({
        cwd: process.cwd(),
        command: invocation.command,
        args: invocation.args,
        env: currentProcessEnv()
      }).pipe(
        Effect.mapError((error) =>
          controllerBootstrapError(`Failed to start docker-git controller.\nDetails: ${String(error)}`)
        )
      )
    )

    if (exitCode === 0) {
      return
    }

    const failureMessage = formatDockerInvocationFailure(
      "Failed to start docker-git controller.",
      invocation,
      exitCode
    )
    return yield* _(
      Effect.fail(controllerBootstrapError(failureMessage))
    )
  })

export const controllerExists = (): Effect.Effect<boolean, ControllerBootstrapError, ControllerRuntime> =>
  runDockerExitCodeCommand(["inspect", controllerContainerName]).pipe(
    Effect.map((exitCode) => exitCode === 0)
  )

export const inspectControllerRevision = (): Effect.Effect<
  string | null,
  ControllerBootstrapError,
  ControllerRuntime
> =>
  controllerExists().pipe(
    Effect.flatMap((exists) =>
      exists
        ? runDockerCapture(
          ["inspect", "-f", inspectEnvTemplate, controllerContainerName],
          `Failed to inspect env for ${controllerContainerName}`
        ).pipe(
          Effect.map((output) => parseControllerRevisionEnvOutput(output)),
          Effect.orElseSucceed((): string | null => null)
        )
        : Effect.succeed<string | null>(null)
    )
  )

export const inspectControllerRunning = (): Effect.Effect<boolean, never, ControllerRuntime> =>
  runDockerCapture(
    ["inspect", "-f", inspectStateRunningTemplate, controllerContainerName],
    `Failed to inspect running state for ${controllerContainerName}`
  ).pipe(
    Effect.map(isDockerInspectBooleanOutputTrue),
    Effect.orElseSucceed((): boolean => false)
  )

export const prepareLocalControllerRevision = (): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  ControllerCompose.prepareControllerRevision()

export const inspectContainerNetworks = (
  containerName: string
): Effect.Effect<DockerNetworkIps, never, ControllerRuntime> =>
  runDockerCapture(
    ["inspect", "-f", inspectNetworksTemplate, containerName],
    `Failed to inspect Docker networks for ${containerName}`
  ).pipe(
    Effect.map((output) => parseDockerNetworkIps(output)),
    Effect.orElseSucceed((): DockerNetworkIps => ({}))
  )

export const inspectControllerPublishedPorts = (): Effect.Effect<string, never, ControllerRuntime> =>
  runDockerCapture(
    ["port", controllerContainerName],
    `Failed to inspect published ports for ${controllerContainerName}`
  ).pipe(
    Effect.map((output) => output.trim()),
    Effect.orElseSucceed((): string => "unavailable")
  )

export const resolveCurrentContainerNetworks = (): Effect.Effect<DockerNetworkIps, never, ControllerRuntime> =>
  readCurrentContainerName().pipe(
    Effect.flatMap((containerName) => inspectContainerNetworks(containerName))
  )

const connectControllerToNetworkBestEffort = (
  networkName: string
): Effect.Effect<void, never, ControllerRuntime> => {
  const trimmed = networkName.trim()
  if (trimmed.length === 0 || trimmed === "host" || trimmed === "none") {
    return Effect.void
  }

  return runDockerExitCodeCommand(["network", "connect", trimmed, controllerContainerName]).pipe(
    Effect.asVoid,
    Effect.orElseSucceed(() => {})
  )
}

export const ensureControllerReachabilityNetworks = (
  currentContainerNetworks: DockerNetworkIps
): Effect.Effect<void, never, ControllerRuntime> =>
  Effect.forEach(
    uniqueStrings(["bridge", ...Object.keys(currentContainerNetworks)]),
    (networkName) => connectControllerToNetworkBestEffort(networkName),
    { discard: true }
  )
