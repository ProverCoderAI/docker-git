import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { composeFilesForMode, prepareControllerRevision, resolveControllerComposeFiles } from "./controller-compose.js"
import { readCurrentContainerName } from "./controller-hostname.js"
import {
  runCommandCaptureWithFailureOutput,
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

export {
  controllerBuildSkillerEnvKey,
  controllerGpuModeEnvKey,
  controllerRevisionForMode,
  parseControllerBuildSkillerMode,
  parseControllerGpuMode
} from "./controller-compose.js"

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

// CHANGE: include captured Docker output in command failure diagnostics
// WHY: callers need typed errors that can distinguish missing images from Docker access failures
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: output = "" -> base_message; output != "" -> base_message + output
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: the original headline, invocation and exit code are always preserved
// COMPLEXITY: O(n) where n = |output|
/**
 * Formats Docker command failure diagnostics with optional captured output.
 *
 * @param headline - Human-readable failure headline.
 * @param invocation - Resolved Docker command invocation.
 * @param exitCode - Process exit code.
 * @param output - Combined stdout/stderr captured from the process.
 * @returns Stable multi-line diagnostic message.
 *
 * @pure true
 * @effect n/a
 * @invariant Empty output does not add an output section.
 * @precondition `headline` is non-empty and `exitCode` is the process exit code.
 * @postcondition The returned message preserves the command and exit code.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never
 */
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

// CHANGE: share Docker command resolution between exit-code and capture paths
// WHY: all controller Docker operations must use the same direct/sudo resolution and argument composition
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: resolve(args) = build(resolveDockerCommand(), args)
// PURITY: SHELL
// EFFECT: Effect<DockerInvocation, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: returned invocation always has a concrete command and immutable args
// COMPLEXITY: O(|args|)
/**
 * Resolves the Docker executable and composes it with operation arguments.
 *
 * @param args - Docker CLI arguments after the executable.
 * @returns Effect containing the concrete command invocation.
 *
 * @pure false
 * @effect CommandExecutor through Docker probing.
 * @invariant Invocation command defaults to `docker` only when the resolved command list is empty.
 * @precondition `args` is a finite argument vector.
 * @postcondition Sudo/direct Docker probing errors remain typed `ControllerBootstrapError` failures.
 * @complexity O(n) time and O(n) space where n = |args|.
 * @throws Never - all failures are represented in the Effect error channel.
 */
const resolveDockerInvocation = (
  args: ReadonlyArray<string>
): Effect.Effect<DockerInvocation, ControllerBootstrapError, ControllerRuntime> =>
  resolveDockerCommand().pipe(
    Effect.map((dockerCommand) => buildDockerInvocation(dockerCommand, args))
  )

const runDockerExitCodeCommand = (
  args: ReadonlyArray<string>
): Effect.Effect<number, ControllerBootstrapError, ControllerRuntime> =>
  resolveDockerInvocation(args).pipe(
    Effect.flatMap((invocation) => runExitCode(invocation.command, invocation.args))
  )

// CHANGE: preserve typed Docker capture errors while normalizing platform failures
// WHY: callers must see daemon/socket diagnostics instead of nullable fallback for infrastructure failures
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: ControllerBootstrapError -> same; PlatformError -> ControllerBootstrapError(label, details)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: existing ControllerBootstrapError messages are preserved exactly
// COMPLEXITY: O(|error|)
/**
 * Builds a mapper from command runner errors into controller bootstrap errors.
 *
 * @param label - Operation label used for platform error diagnostics.
 * @returns A total error mapper for Docker capture effects.
 *
 * @pure true
 * @effect n/a
 * @invariant Existing `ControllerBootstrapError` values are returned unchanged.
 * @precondition `label` is finite human-readable text.
 * @postcondition Non-controller platform errors include the operation label and original details.
 * @complexity O(n) where n = |error string|.
 * @throws Never
 */
const mapDockerCaptureError =
  (label: string) => (error: ControllerBootstrapError | PlatformError): ControllerBootstrapError =>
    error._tag === "ControllerBootstrapError"
      ? error
      : controllerBootstrapError(`${label} failed.\nDetails: ${String(error)}`)

// CHANGE: choose whether a Docker capture failure includes process output
// WHY: regular callers keep stable messages, while image inspection needs output for missing-image classification
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: includeOutput -> failure_with_output; !includeOutput -> base_failure
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: both modes preserve headline, command and exit code
// COMPLEXITY: O(|output|)
/**
 * Formats a Docker capture failure according to the selected diagnostic mode.
 *
 * @param label - Operation label.
 * @param invocation - Resolved Docker invocation.
 * @param exitCode - Process exit code.
 * @param output - Combined stdout/stderr from the process.
 * @param includeOutput - Whether the message should include captured process output.
 * @returns Stable Docker failure message.
 *
 * @pure true
 * @effect n/a
 * @invariant Base diagnostics always include command and exit code.
 * @precondition `exitCode` is the observed process exit code.
 * @postcondition Captured output appears only when `includeOutput` is true and output is non-empty.
 * @complexity O(n) where n = |output|.
 * @throws Never
 */
const formatDockerCaptureFailure = (
  label: string,
  invocation: DockerInvocation,
  exitCode: number,
  output: string,
  includeOutput: boolean
): string =>
  includeOutput
    ? formatDockerInvocationFailureWithOutput(`${label} failed.`, invocation, exitCode, output)
    : formatDockerInvocationFailure(`${label} failed.`, invocation, exitCode)

// CHANGE: centralize Docker capture execution for regular and diagnostic modes
// WHY: selective recovery must not duplicate Docker probing, invocation building, or platform error mapping
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: docker_exit=0 -> stdout; docker_exit!=0 -> ControllerBootstrapError(mode)
// PURITY: SHELL
// EFFECT: Effect<string, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: no Docker capture failure is converted to success
// COMPLEXITY: O(command_output)
/**
 * Runs a Docker command and maps non-zero exits through the selected output mode.
 *
 * @param args - Docker CLI arguments after the executable.
 * @param label - Operation label used in diagnostics.
 * @param includeOutput - Whether non-zero exit diagnostics include captured stdout/stderr.
 * @returns Effect containing stdout on success.
 *
 * @pure false
 * @effect CommandExecutor, FileSystem, Path through ControllerRuntime.
 * @invariant Docker probing and command execution failures stay in the typed error channel.
 * @precondition `args` is finite and `label` is non-empty.
 * @postcondition Success implies Docker exited with code 0.
 * @complexity O(n) time and O(n) space where n is captured output size.
 * @throws Never - all failures are represented in the Effect error channel.
 */
const runDockerCaptureWithOutputMode = (
  args: ReadonlyArray<string>,
  label: string,
  includeOutput: boolean
): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
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
          controllerBootstrapError(formatDockerCaptureFailure(label, invocation, exitCode, output, includeOutput))
      )
    ),
    Effect.mapError(mapDockerCaptureError(label))
  )

export const runDockerCapture = (
  args: ReadonlyArray<string>,
  label: string
): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  runDockerCaptureWithOutputMode(args, label, false)

// CHANGE: preserve Docker stderr/stdout diagnostics for selective error recovery
// WHY: image revision inspection must fallback only for absent images while surfacing daemon/socket failures
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: CodeRabbit PR #344 review 4349265315
// SOURCE: n/a
// FORMAT THEOREM: docker_exit ∉ ok -> ControllerBootstrapError(message includes output)
// PURITY: SHELL
// EFFECT: Effect<string, ControllerBootstrapError, ControllerRuntime>
// INVARIANT: Docker access resolution errors remain ControllerBootstrapError failures
// COMPLEXITY: O(command_output)
/**
 * Runs a Docker command and includes captured stdout/stderr in the typed failure message.
 *
 * @param args - Docker CLI arguments after the resolved docker executable.
 * @param label - Human-readable operation label used in failure diagnostics.
 * @returns Effect containing stdout when Docker exits successfully.
 *
 * @pure false
 * @effect CommandExecutor, FileSystem, Path through ControllerRuntime.
 * @invariant Non-zero Docker exits are failures and preserve the combined command output.
 * @precondition `args` is a finite Docker argument vector and `label` is non-empty.
 * @postcondition Docker daemon/socket discovery errors are not converted to success.
 * @complexity O(n) time and O(n) space where n is captured command output.
 * @throws Never - all failures are represented in the Effect error channel.
 */
export const runDockerCaptureWithFailureOutput = (
  args: ReadonlyArray<string>,
  label: string
): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  runDockerCaptureWithOutputMode(args, label, true)

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
