import { describe, expect, it } from "@effect/vitest"

import { runDockerComposeDownVolumes, dockerComposeUpRecreateArgs, parseDockerPublishedHostPorts } from "../../src/shell/docker.js"

import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const makeCommandRecorder = (recorded: Array<RecordedCommand>): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: (_data) => Effect.void,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "DockerTestProcess" }),
        toString: () => "DockerTestProcess",
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const includesArgsInOrder = (
  args: ReadonlyArray<string>,
  expected: ReadonlyArray<string>
): boolean => {
  let offset = 0
  for (const token of expected) {
    const foundAt = args.indexOf(token, offset)
    if (foundAt === -1) {
      return false
    }
    offset = foundAt + 1
  }
  return true
}

it.effect("passes docker compose down -v --remove-orphans", () =>
  Effect.gen(function*(_) {
    const recorded: Array<RecordedCommand> = []
    const executor = makeCommandRecorder(recorded)
    const command = yield* _(
      runDockerComposeDownVolumes("/tmp").pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor)
      )
    )

    expect(
      recorded.some(
        (entry) =>
          entry.command === "docker" &&
          includesArgsInOrder(entry.args, ["compose", "down", "-v", "--remove-orphans"])
      )
    ).toBe(true)
    expect(command).toBeUndefined()
  })
)

describe("docker compose args", () => {
  it("uses build when force-env recreates containers", () => {
    expect(dockerComposeUpRecreateArgs).toEqual(["up", "-d", "--build", "--force-recreate"])
  })
})

describe("parseDockerPublishedHostPorts", () => {
  it("extracts unique published host ports from docker ps output", () => {
    const output = [
      "127.0.0.1:2222->22/tcp",
      "0.0.0.0:5672->5672/tcp, [::]:5672->5672/tcp",
      "5900/tcp, 6080/tcp, 9223/tcp",
      ":::8080->80/tcp"
    ].join("\n")

    expect(parseDockerPublishedHostPorts(output)).toEqual([2222, 5672, 8080])
  })

  it("returns empty array when no host ports are published", () => {
    expect(parseDockerPublishedHostPorts("5900/tcp, 6080/tcp")).toEqual([])
  })
})
