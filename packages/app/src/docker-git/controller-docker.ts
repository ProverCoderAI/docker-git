import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { composeFilesForMode, prepareControllerRevision, resolveControllerComposeFiles } from "./controller-compose.js"
import {
  runCommandCapture,
  runCommandExitCode,
  runCommandExitCodeStreaming,
  runCommandWithCapturedOutput
} from "./frontend-lib/shell/command-runner.js"

import { type DockerProbeOutcome, renderDockerAccessDeniedMessage } from "./controller-docker-diagnostics.js"
import {
  type DockerNetworkIps,
  parseDockerNetworkIps,
  resolveConfiguredApiBaseUrl,
  uniqueStrings
} from "./controller-reachability.js"
import { parseControllerRevisionEnvOutput } from "./controller-revision.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export { controllerGpuModeEnvKey, controllerRevisionForMode, parseControllerGpuMode } from "./controller-compose.js"

export type ControllerRuntime =
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | Path.Path

export const controllerContainerName = process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || "docker-git-api"

const inspectNetworksTemplate = String
  .raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`
const inspectEnvTemplate = String.raw`{{range .Config.Env}}{{println .}}{{end}}`

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const currentProcessEnv = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )

const runExitCode = (
  command: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, never, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd: process.cwd(),
    command,
    args
  }).pipe(
    Effect.match({
      onFailure: () => 1,
      onSuccess: (exitCode) => exitCode
    })
  )

type ProbeFailure = {
  readonly _tag: "ProbeFailure"
  readonly outcome: DockerProbeOutcome
}

const captureProbeOutcome = (
  command: string,
  args: ReadonlyArray<string>
): Effect.Effect<DockerProbeOutcome, never, CommandExecutor.CommandExecutor> =>
  runCommandWithCapturedOutput(
    { cwd: process.cwd(), command, args },
    [0],
    (exitCode, output): ProbeFailure => ({
      _tag: "ProbeFailure",
      outcome: { exitCode, stderr: output }
    })
  ).pipe(
    Effect.match({
      onFailure: (error) =>
        "outcome" in error
          ? error.outcome
          : { exitCode: 127, stderr: String(error) },
      onSuccess: () => ({ exitCode: 0, stderr: "" })
    })
  )

export const resolveDockerCommand = (): Effect.Effect<
  ReadonlyArray<string>,
  ControllerBootstrapError,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const directProbe = yield* _(captureProbeOutcome("docker", ["info"]))
    if (directProbe.exitCode === 0) {
      return ["docker"]
    }

    const sudoProbe = yield* _(captureProbeOutcome("sudo", ["-n", "docker", "info"]))
    if (sudoProbe.exitCode === 0) {
      return ["sudo", "-n", "docker"]
    }

    const dockerHostRaw = process.env["DOCKER_HOST"]?.trim() ?? ""
    return yield* _(
      Effect.fail(
        controllerBootstrapError(
          renderDockerAccessDeniedMessage({
            directProbe,
            sudoProbe,
            apiBaseUrl: resolveConfiguredApiBaseUrl(),
            dockerHost: dockerHostRaw.length > 0 ? dockerHostRaw : null
          })
        )
      )
    )
  })

type DockerInvocation = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const buildDockerInvocation = (
  dockerCommand: ReadonlyArray<string>,
  args: ReadonlyArray<string>
): DockerInvocation => ({
  command: dockerCommand[0] ?? "docker",
  args: [...dockerCommand.slice(1), ...args]
})

const formatDockerInvocationFailure = (
  headline: string,
  invocation: DockerInvocation,
  exitCode: number
): string =>
  [
    headline,
    `Command: ${[invocation.command, ...invocation.args].join(" ")}`,
    `Exit code: ${exitCode}`
  ].join("\n")

const runDockerExitCodeCommand = (
  args: ReadonlyArray<string>
): Effect.Effect<number, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const dockerCommand = yield* _(resolveDockerCommand())
    const invocation = buildDockerInvocation(dockerCommand, args)
    return yield* _(runExitCode(invocation.command, invocation.args))
  })

export const runDockerCapture = (
  args: ReadonlyArray<string>,
  label: string
): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const dockerCommand = yield* _(resolveDockerCommand())
    const invocation = buildDockerInvocation(dockerCommand, args)
    const output = yield* _(
      runCommandCapture(
        {
          cwd: process.cwd(),
          command: invocation.command,
          args: invocation.args
        },
        [0],
        (exitCode) => controllerBootstrapError(formatDockerInvocationFailure(`${label} failed.`, invocation, exitCode))
      )
    )

    return output
  }).pipe(
    Effect.mapError((error): ControllerBootstrapError =>
      error._tag === "ControllerBootstrapError"
        ? error
        : controllerBootstrapError(`${label} failed.\nDetails: ${String(error)}`)
    )
  )

export const runCompose = (
  args: ReadonlyArray<string>
): Effect.Effect<void, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const dockerCommand = yield* _(resolveDockerCommand())
    const composeFiles = yield* _(resolveControllerComposeFiles())
    const invocation = buildDockerInvocation(dockerCommand, [
      "compose",
      ...composeFilesForMode(composeFiles.composePath, composeFiles.gpuOverlayPath),
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

    return yield* _(
      Effect.fail(
        controllerBootstrapError(
          formatDockerInvocationFailure("Failed to start docker-git controller.", invocation, exitCode)
        )
      )
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

export const prepareLocalControllerRevision = (): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  prepareControllerRevision()

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
  inspectContainerNetworks(process.env["HOSTNAME"]?.trim() ?? "")

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
