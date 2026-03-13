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

const seedDockerVolumeScript = String.raw`set -eu
mkdir -p /dest
if [[ -d /src ]]; then
  cp -an /src/. /dest/ 2>/dev/null || true
  find /dest -type f -name auth.json -exec chmod 600 {} + >/dev/null 2>&1 || true
fi`

export const runDockerVolumeSeedFromDir = (
  cwd: string,
  volumeName: string,
  sourceDir: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/dest`,
        "-v",
        `${sourceDir}:/src:ro`,
        "ubuntu:24.04",
        "bash",
        "-lc",
        seedDockerVolumeScript
      ]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )
