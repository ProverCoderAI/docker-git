import * as Command from "@effect/platform/Command"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { runCommandCapture } from "./command-runner.js"
import { parseInspectNetworkEntry } from "./docker-inspect-parse.js"
import { CommandFailedError, DockerCommandError } from "./errors.js"

type DockerInspectReader<A> = (
  cwd: string,
  containerName: string
) => Effect.Effect<A, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor>

const createDockerInspectReader = <A>(
  format: string,
  parse: (output: string) => A
): DockerInspectReader<A> =>
(cwd, containerName) =>
  pipe(
    runDockerInspectValue(cwd, containerName, format),
    Effect.map((output) => parse(output))
  )

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

export const runDockerInspectContainerIp = createDockerInspectReader(
  String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`,
  (output) => {
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
  }
)

export const runDockerInspectContainerBridgeIp = createDockerInspectReader(
  "{{with (index .NetworkSettings.Networks \"bridge\")}}{{.IPAddress}}{{end}}",
  (output) => output.trim()
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
