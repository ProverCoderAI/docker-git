import * as Command from "@effect/platform/Command"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { trimToUndefined } from "../../shared/trimmed-text.js"
import { runCommandCapture } from "./command-runner.js"
import { parseInspectNetworkEntry } from "./docker-inspect-parse.js"
import { CommandFailedError, DockerCommandError } from "./errors.js"

export type DockerContainerRuntimeInfo = {
  readonly containerName: string
  readonly running: boolean
  readonly ipAddress: string
  readonly projectWorkingDir?: string | undefined
  readonly composeService?: string | undefined
}

const runDockerInspectValue = (
  cwd: string,
  containerName: string,
  format: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: ["inspect", "-f", format, containerName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )

export const runDockerExecExitCode = (
  cwd: string,
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const command = pipe(
      Command.make("docker", "exec", containerName, ...args),
      Command.workingDirectory(cwd),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
    const exitCode = yield* _(Command.exitCode(command))
    return Number(exitCode)
  })

export const runDockerInspectContainerIp = (
  cwd: string,
  containerName: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runDockerInspectValue(
      cwd,
      containerName,
      String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`
    ),
    Effect.map((output) => {
      const lines = output
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const entries = lines.flatMap((line) => parseInspectNetworkEntry(line))
      if (entries.length === 0) {
        return ""
      }

      const entryMap = new Map(entries)
      return entryMap.get("bridge") ?? entries[0]![1]
    })
  )

export const runDockerInspectContainerRuntimeInfo = (
  cwd: string,
  containerName: string
): Effect.Effect<DockerContainerRuntimeInfo | null, PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runDockerInspectValue(
      cwd,
      containerName,
      `{{.State.Status}}\t{{with index .Config.Labels "com.docker.compose.project.working_dir"}}{{.}}{{end}}\t{{with index .Config.Labels "com.docker.compose.service"}}{{.}}{{end}}`
    ),
    Effect.flatMap((output) => {
      const [status, projectWorkingDir, composeService] = output.trim().replaceAll(String.raw`\t`, "\t").split("\t")
      if ((status?.trim() ?? "") !== "running") {
        return Effect.succeed(null)
      }

      return runDockerInspectContainerIp(cwd, containerName).pipe(
        Effect.map((ipAddress) => ({
          containerName,
          running: true,
          ipAddress,
          projectWorkingDir: trimToUndefined(projectWorkingDir),
          composeService: trimToUndefined(composeService)
        }))
      )
    }),
    Effect.catchTag("DockerCommandError", () => Effect.succeed(null))
  )

export const runDockerInspectContainerBridgeIp = (
  cwd: string,
  containerName: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runDockerInspectValue(
      cwd,
      containerName,
      "{{with (index .NetworkSettings.Networks \"bridge\")}}{{.IPAddress}}{{end}}"
    ),
    Effect.map((output) => output.trim())
  )

export const runDockerPsNames = (
  cwd: string
): Effect.Effect<ReadonlyArray<string>, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: ["ps", "--format", "{{.Names}}"]
      },
      [Number(ExitCode(0))],
      (exitCode) => new CommandFailedError({ command: "docker ps", exitCode })
    ),
    Effect.map((output) =>
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
  )
