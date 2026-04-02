import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { runCommandCapture, runCommandExitCode } from "@lib/shell/command-runner"

import { type DockerNetworkIps, parseDockerNetworkIps, uniqueStrings } from "./controller-reachability.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export type ControllerRuntime =
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | Path.Path

export const controllerContainerName = "docker-git-api"

const inspectNetworksTemplate = String
  .raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const composeFilePath = (): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    let current = process.cwd()

    for (;;) {
      const candidate = path.join(current, "docker-compose.yml")
      const exists = yield* _(fs.exists(candidate))
      if (exists) {
        return candidate
      }

      const parent = path.dirname(current)
      if (parent === current) {
        return path.resolve(process.cwd(), "docker-compose.yml")
      }
      current = parent
    }
  })

const mapComposePathError = (error: PlatformError): ControllerBootstrapError =>
  controllerBootstrapError(`Failed to resolve docker-compose.yml path.\nDetails: ${String(error)}`)

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

export const resolveDockerCommand = (): Effect.Effect<
  ReadonlyArray<string>,
  never,
  CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const dockerInfoExit = yield* _(runExitCode("docker", ["info"]))
    if (dockerInfoExit === 0) {
      return ["docker"]
    }

    const sudoDockerInfoExit = yield* _(runExitCode("sudo", ["-n", "docker", "info"]))
    return sudoDockerInfoExit === 0 ? ["sudo", "docker"] : ["docker"]
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
): Effect.Effect<number, never, ControllerRuntime> =>
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
    const composePath = yield* _(composeFilePath().pipe(Effect.mapError(mapComposePathError)))
    const invocation = buildDockerInvocation(dockerCommand, [
      "compose",
      "-f",
      composePath,
      ...args
    ])
    const exitCode = yield* _(runExitCode(invocation.command, invocation.args))

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

  return runDockerExitCodeCommand(["network", "connect", trimmed, controllerContainerName]).pipe(Effect.asVoid)
}

export const ensureControllerReachabilityNetworks = (
  currentContainerNetworks: DockerNetworkIps
): Effect.Effect<void, never, ControllerRuntime> =>
  Effect.forEach(
    uniqueStrings(["bridge", ...Object.keys(currentContainerNetworks)]),
    (networkName) => connectControllerToNetworkBestEffort(networkName),
    { discard: true }
  )
