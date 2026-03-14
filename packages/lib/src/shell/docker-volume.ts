import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type { Effect } from "effect"

import { runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

export const runDockerVolumeCreate = (
  cwd: string,
  volumeName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes({ cwd, command: "docker", args: ["volume", "create", volumeName] }, [Number(ExitCode(0))], (
    exitCode
  ) => new DockerCommandError({ exitCode }))
