import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { type DockerProbeOutcome, renderDockerAccessDeniedMessage } from "./controller-docker-diagnostics.js"
import { resolveConfiguredApiBaseUrl } from "./controller-reachability.js"
import {
  runCommandCaptureWithFailureOutput,
  runCommandExitCode,
  runCommandWithCapturedOutput
} from "./frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export type ControllerDockerCommandRuntime = CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

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
    const accessDeniedMessage = renderDockerAccessDeniedMessage({
      directProbe,
      sudoProbe,
      apiBaseUrl: resolveConfiguredApiBaseUrl(),
      dockerHost: dockerHostRaw.length > 0 ? dockerHostRaw : null
    })
    return yield* _(Effect.fail(controllerBootstrapError(accessDeniedMessage)))
  })

type DockerInvocation = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export const buildDockerInvocation = (
  dockerCommand: ReadonlyArray<string>,
  args: ReadonlyArray<string>
): DockerInvocation => ({
  command: dockerCommand[0] ?? "docker",
  args: [...dockerCommand.slice(1), ...args]
})

export const formatDockerInvocationFailure = (
  headline: string,
  invocation: DockerInvocation,
  exitCode: number
): string =>
  [
    headline,
    `Command: ${[invocation.command, ...invocation.args].join(" ")}`,
    `Exit code: ${exitCode}`
  ].join("\n")

const formatDockerInvocationFailureWithOutput = (
  headline: string,
  invocation: DockerInvocation,
  exitCode: number,
  output: string
): string =>
  [
    formatDockerInvocationFailure(headline, invocation, exitCode),
    output.trim().length > 0 ? `Output:\n${output.trim()}` : ""
  ].filter((part) => part.length > 0).join("\n")

const resolveDockerInvocation = (
  args: ReadonlyArray<string>
): Effect.Effect<DockerInvocation, ControllerBootstrapError, ControllerDockerCommandRuntime> =>
  resolveDockerCommand().pipe(
    Effect.map((dockerCommand) => buildDockerInvocation(dockerCommand, args))
  )

export const runDockerExitCodeCommand = (
  args: ReadonlyArray<string>
): Effect.Effect<number, ControllerBootstrapError, ControllerDockerCommandRuntime> =>
  resolveDockerInvocation(args).pipe(
    Effect.flatMap((invocation) => runExitCode(invocation.command, invocation.args))
  )

const mapDockerCaptureError =
  (label: string) => (error: ControllerBootstrapError | PlatformError): ControllerBootstrapError =>
    error._tag === "ControllerBootstrapError"
      ? error
      : controllerBootstrapError(`${label} failed.\nDetails: ${String(error)}`)

const formatDockerCaptureFailure = (
  label: string,
  invocation: DockerInvocation,
  exitCode: number,
  output: string,
  shouldIncludeOutput: boolean
): string =>
  shouldIncludeOutput
    ? formatDockerInvocationFailureWithOutput(`${label} failed.`, invocation, exitCode, output)
    : formatDockerInvocationFailure(`${label} failed.`, invocation, exitCode)

const runDockerCaptureWithOutputMode = (
  args: ReadonlyArray<string>,
  label: string,
  shouldIncludeOutput: boolean
): Effect.Effect<string, ControllerBootstrapError, ControllerDockerCommandRuntime> =>
  resolveDockerInvocation(args).pipe(
    Effect.flatMap((invocation) =>
      runCommandCaptureWithFailureOutput(
        {
          cwd: process.cwd(),
          command: invocation.command,
          args: invocation.args
        },
        [0],
        (exitCode, output) =>
          controllerBootstrapError(formatDockerCaptureFailure(label, invocation, exitCode, output, shouldIncludeOutput))
      )
    ),
    Effect.mapError(mapDockerCaptureError(label))
  )

export const runDockerCapture = (
  args: ReadonlyArray<string>,
  label: string
): Effect.Effect<string, ControllerBootstrapError, ControllerDockerCommandRuntime> =>
  runDockerCaptureWithOutputMode(args, label, false)

export const runDockerCaptureWithFailureOutput = (
  args: ReadonlyArray<string>,
  label: string
): Effect.Effect<string, ControllerBootstrapError, ControllerDockerCommandRuntime> =>
  runDockerCaptureWithOutputMode(args, label, true)
