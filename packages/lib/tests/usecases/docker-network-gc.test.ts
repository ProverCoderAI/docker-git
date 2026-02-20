import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import {
  ensureComposeNetworkReady,
  gcProjectNetworkByTemplate
} from "../../src/usecases/docker-network-gc.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

type FakeState = {
  readonly existingNetworks: Set<string>
  readonly containerCountByNetwork: Map<string, number>
}

type SharedTemplate = {
  readonly serviceName: string
  readonly dockerNetworkMode: "shared"
  readonly dockerSharedNetworkName: string
}

type ProjectTemplate = {
  readonly serviceName: string
  readonly dockerNetworkMode: "project"
  readonly dockerSharedNetworkName: string
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const makeFakeExecutor = (
  recorded: Array<RecordedCommand>,
  initialNetworks: ReadonlyArray<string>,
  containerCounts: ReadonlyArray<readonly [string, number]>
): CommandExecutor.CommandExecutor => {
  const state: FakeState = {
    existingNetworks: new Set(initialNetworks),
    containerCountByNetwork: new Map(containerCounts)
  }

  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const last = flattened[flattened.length - 1]!
      const args = last.args
      const inspectFlagIndex = args.indexOf("-f")
      const isDockerNetworkInspect = last.command === "docker" && args[0] === "network" && args[1] === "inspect"
      const isDockerNetworkCreate = last.command === "docker" && args[0] === "network" && args[1] === "create"
      const isDockerNetworkRemove = last.command === "docker" && args[0] === "network" && args[1] === "rm"

      let exitCode = 0
      let stdoutText = ""

      if (isDockerNetworkInspect && inspectFlagIndex === -1) {
        const networkName = args[2] ?? ""
        exitCode = state.existingNetworks.has(networkName) ? 0 : 1
      }

      if (isDockerNetworkInspect && inspectFlagIndex >= 0) {
        const networkName = args[inspectFlagIndex + 2] ?? ""
        if (!state.existingNetworks.has(networkName)) {
          exitCode = 1
        } else {
          const count = state.containerCountByNetwork.get(networkName) ?? 0
          stdoutText = `${count}\n`
        }
      }

      if (isDockerNetworkCreate) {
        const networkName = args[4] ?? ""
        if (networkName.length > 0) {
          state.existingNetworks.add(networkName)
          if (!state.containerCountByNetwork.has(networkName)) {
            state.containerCountByNetwork.set(networkName, 0)
          }
        }
      }

      if (isDockerNetworkRemove) {
        const networkName = args[2] ?? ""
        if (!state.existingNetworks.has(networkName)) {
          exitCode = 1
        } else {
          state.existingNetworks.delete(networkName)
          state.containerCountByNetwork.delete(networkName)
        }
      }

      const stdout = stdoutText.length > 0 ? Stream.succeed(encode(stdoutText)) : Stream.empty
      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({ _tag: "DockerNetworkGcTestProcess", command: last.command, args: last.args, exitCode }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "DockerNetworkGcTestProcess",
          command: last.command,
          args: last.args
        }),
        toString: () => `[DockerNetworkGcTestProcess ${last.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("docker network shared mode", () => {
  it.effect("creates shared network when missing", () =>
    Effect.gen(function*(_) {
      const recorded: Array<RecordedCommand> = []
      const executor = makeFakeExecutor(recorded, [], [])
      const template: SharedTemplate = {
        serviceName: "dg-test",
        dockerNetworkMode: "shared",
        dockerSharedNetworkName: "docker-git-shared"
      }

      yield* _(
        ensureComposeNetworkReady("/tmp", template).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      const created = recorded.some(
        (entry) =>
          entry.command === "docker" &&
          entry.args[0] === "network" &&
          entry.args[1] === "create" &&
          entry.args[4] === "docker-git-shared"
      )
      expect(created).toBe(true)
    }))

  it.effect("does not create shared network when it already exists", () =>
    Effect.gen(function*(_) {
      const recorded: Array<RecordedCommand> = []
      const executor = makeFakeExecutor(recorded, ["docker-git-shared"], [])
      const template: SharedTemplate = {
        serviceName: "dg-test",
        dockerNetworkMode: "shared",
        dockerSharedNetworkName: "docker-git-shared"
      }

      yield* _(
        ensureComposeNetworkReady("/tmp", template).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      const created = recorded.some(
        (entry) =>
          entry.command === "docker" &&
          entry.args[0] === "network" &&
          entry.args[1] === "create"
      )
      expect(created).toBe(false)
    }))
})

describe("docker network gc", () => {
  it.effect("removes detached project network", () =>
    Effect.gen(function*(_) {
      const recorded: Array<RecordedCommand> = []
      const executor = makeFakeExecutor(recorded, ["dg-test-net"], [["dg-test-net", 0]])
      const template: ProjectTemplate = {
        serviceName: "dg-test",
        dockerNetworkMode: "project",
        dockerSharedNetworkName: "docker-git-shared"
      }

      yield* _(
        gcProjectNetworkByTemplate("/tmp", template).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      const removed = recorded.some(
        (entry) =>
          entry.command === "docker" &&
          entry.args[0] === "network" &&
          entry.args[1] === "rm" &&
          entry.args[2] === "dg-test-net"
      )
      expect(removed).toBe(true)
    }))

  it.effect("keeps in-use project network", () =>
    Effect.gen(function*(_) {
      const recorded: Array<RecordedCommand> = []
      const executor = makeFakeExecutor(recorded, ["dg-test-net"], [["dg-test-net", 2]])
      const template: ProjectTemplate = {
        serviceName: "dg-test",
        dockerNetworkMode: "project",
        dockerSharedNetworkName: "docker-git-shared"
      }

      yield* _(
        gcProjectNetworkByTemplate("/tmp", template).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, executor)
        )
      )

      const removed = recorded.some(
        (entry) =>
          entry.command === "docker" &&
          entry.args[0] === "network" &&
          entry.args[1] === "rm" &&
          entry.args[2] === "dg-test-net"
      )
      expect(removed).toBe(false)
    }))
})
