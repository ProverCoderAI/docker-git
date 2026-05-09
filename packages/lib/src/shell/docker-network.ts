import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

const dockerSuccessExitCodes = [Number(ExitCode(0))]

const createDockerNetworkError = (exitCode: number): DockerCommandError => new DockerCommandError({ exitCode })

const buildDockerNetworkCommand = (
  cwd: string,
  args: ReadonlyArray<string>
): { readonly cwd: string; readonly command: string; readonly args: ReadonlyArray<string> } => ({
  cwd,
  command: "docker",
  args
})

const runDockerNetworkCommand = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    buildDockerNetworkCommand(cwd, args),
    dockerSuccessExitCodes,
    createDockerNetworkError
  )

const runDockerNetworkCapture = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    buildDockerNetworkCommand(cwd, args),
    dockerSuccessExitCodes,
    createDockerNetworkError
  )

export const runDockerNetworkConnectBridge = (
  cwd: string,
  containerName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerNetworkCapture(cwd, ["network", "connect", "bridge", containerName]).pipe(Effect.asVoid)

export const runDockerNetworkExists = (
  cwd: string,
  networkName: string
): Effect.Effect<boolean, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd,
    command: "docker",
    args: ["network", "inspect", networkName]
  }).pipe(Effect.map((exitCode) => exitCode === 0))

export const runDockerNetworkCreateBridge = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerNetworkCommand(cwd, ["network", "create", "--driver", "bridge", networkName])

export const runDockerNetworkCreateBridgeWithSubnet = (
  cwd: string,
  networkName: string,
  subnet: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerNetworkCommand(cwd, ["network", "create", "--driver", "bridge", "--subnet", subnet, networkName])

export const runDockerNetworkContainerCount = (
  cwd: string,
  networkName: string
): Effect.Effect<number, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerNetworkCapture(cwd, ["network", "inspect", "-f", "{{len .Containers}}", networkName]).pipe(
    Effect.map((output) => {
      const parsed = Number.parseInt(output.trim(), 10)
      return Number.isNaN(parsed) ? 0 : parsed
    })
  )

export const runDockerNetworkRemove = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerNetworkCommand(cwd, ["network", "rm", networkName])
