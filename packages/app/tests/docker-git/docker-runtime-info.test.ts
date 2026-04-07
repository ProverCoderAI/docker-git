import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { runDockerInspectContainerRuntimeInfo } from "../../src/lib/shell/docker.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const isRuntimeInspect = (command: RecordedCommand): boolean =>
  command.command === "docker" &&
  command.args[0] === "inspect" &&
  command.args[1] === "-f" &&
  (command.args[2] ?? "").includes(".State.Status")

const isIpInspect = (command: RecordedCommand): boolean =>
  command.command === "docker" &&
  command.args[0] === "inspect" &&
  command.args[1] === "-f" &&
  (command.args[2] ?? "").includes("NetworkSettings.Networks")

const makeFakeExecutor = (outputs: {
  readonly runtimeOutput: string
  readonly ipOutput: string
}): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      const last = flattened[flattened.length - 1]!
      const invocation: RecordedCommand = {
        command: last.command,
        args: last.args
      }

      const stdoutText = isRuntimeInspect(invocation)
        ? outputs.runtimeOutput
        : isIpInspect(invocation)
          ? outputs.ipOutput
          : ""

      const stdout = stdoutText.length === 0
        ? Stream.empty
        : Stream.succeed(encode(stdoutText))

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({ _tag: "DockerRuntimeInfoTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "DockerRuntimeInfoTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[DockerRuntimeInfoTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("runDockerInspectContainerRuntimeInfo", () => {
  it.effect("parses running runtime ownership even when separators arrive as literal escapes", () =>
    Effect.gen(function*(_) {
      const executor = makeFakeExecutor({
        runtimeOutput: "running\\t/home/dev/.docker-git/test-owner/repo\\tdg-repo\n",
        ipOutput: "bridge=172.17.0.15\nproject=10.88.0.2\n"
      })

      const runtime = yield* _(
        runDockerInspectContainerRuntimeInfo("/tmp", "dg-repo").pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      expect(runtime).toEqual({
        containerName: "dg-repo",
        running: true,
        ipAddress: "172.17.0.15",
        projectWorkingDir: "/home/dev/.docker-git/test-owner/repo",
        composeService: "dg-repo"
      })
    }))

  it.effect("keeps optional compose labels undefined when runtime is unlabeled", () =>
    Effect.gen(function*(_) {
      const executor = makeFakeExecutor({
        runtimeOutput: "running\t\t\n",
        ipOutput: "project=10.88.0.4\n"
      })

      const runtime = yield* _(
        runDockerInspectContainerRuntimeInfo("/tmp", "dg-repo").pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      expect(runtime).toEqual({
        containerName: "dg-repo",
        running: true,
        ipAddress: "10.88.0.4",
        projectWorkingDir: undefined,
        composeService: undefined
      })
    }))
})
