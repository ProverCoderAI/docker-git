import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

export const runDockerNetworkConnectBridge = (
  cwd: string,
  containerName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: ["network", "connect", "bridge", containerName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  ).pipe(Effect.asVoid)

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
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "create", "--driver", "bridge", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )

export const runDockerNetworkCreateBridgeWithSubnet = (
  cwd: string,
  networkName: string,
  subnet: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "create", "--driver", "bridge", "--subnet", subnet, networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )

export const runDockerNetworkContainerCount = (
  cwd: string,
  networkName: string
): Effect.Effect<number, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: ["network", "inspect", "-f", "{{len .Containers}}", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  ).pipe(
    Effect.map((output) => {
      const parsed = Number.parseInt(output.trim(), 10)
      return Number.isNaN(parsed) ? 0 : parsed
    })
  )

export const runDockerNetworkRemove = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "rm", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )
