import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as nodePath from "node:path"

import { runDockerUpIfNeeded } from "../../src/usecases/actions/docker-up.js"
import type { CreateCommand } from "../../src/core/domain.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

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

const isDownWithRemoveOrphans = (command: RecordedCommand): boolean =>
  command.command === "docker" &&
  includesArgsInOrder(command.args, ["compose", "down", "-v", "--remove-orphans"])

const isUp = (command: RecordedCommand): boolean =>
  command.command === "docker" &&
  includesArgsInOrder(command.args, ["compose", "up", "-d", "--build"])

const isRmContainer = (name: string) => (command: RecordedCommand): boolean =>
  command.command === "docker" && includesArgsInOrder(command.args, ["rm", "-f", name])

const fakePath: Path.Path = {
  join: (...segments) => nodePath.join(...segments),
  resolve: (...segments) => nodePath.resolve(...segments),
  isAbsolute: (value) => nodePath.isAbsolute(value),
  dirname: (value) => nodePath.dirname(value)
} as Path.Path

const fakeFileSystem: FileSystem.FileSystem = {
  exists: () => Effect.succeed(false)
} as FileSystem.FileSystem

const makeFakeExecutor = (recorded: Array<RecordedCommand>): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const invocation = flattened[flattened.length - 1]!
      const stdoutText =
        invocation.command === "docker" &&
        invocation.args.includes("inspect") &&
        invocation.args.includes("bridge")
          ? "0.0.0.0\n"
          : ""
      const stdout = stdoutText.length === 0 ? Stream.empty : Stream.succeed(encode(stdoutText))

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({
          _tag: "DockerUpTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "DockerUpTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[DockerUpTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("runDockerUpIfNeeded with force", () => {
  it.effect("wipes compose orphans, removes container, then recreates", () =>
    Effect.gen(function*(_) {
      const commands: Array<RecordedCommand> = []
      const resolvedOutDir = "/tmp/docker-git-force-up"
      const config: CreateCommand["config"] = {
        containerName: "dg-force-test",
        serviceName: "dg-force-test",
        sshUser: "dev",
        sshPort: 2237,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/workspaces/org/repo",
        volumeName: "dg-force-test-home",
        dockerGitPath: `${resolvedOutDir}/.docker-git`,
        authorizedKeysPath: "/tmp/authorized_keys",
        envGlobalPath: `${resolvedOutDir}/.orch/env/global.env`,
        envProjectPath: `${resolvedOutDir}/docker-git.env`,
        codexAuthPath: `${resolvedOutDir}/.orch/auth/codex`,
        codexSharedAuthPath: `${resolvedOutDir}/.orch/auth/codex-shared`,
        codexHome: "/home/dev/.codex",
        geminiAuthPath: `${resolvedOutDir}/.orch/auth/gemini`,
        geminiHome: "/home/dev/.gemini",
        dockerNetworkMode: "project",
        dockerSharedNetworkName: "docker-git-shared",
        enableMcpPlaywright: true,
        pnpmVersion: "10.27.0",
        agentMode: undefined,
        agentAuto: false,
        clonedOnHostname: undefined,
        forkRepoUrl: undefined,
        gitTokenLabel: undefined,
        codexAuthLabel: undefined,
        claudeAuthLabel: undefined
      }

      const recordedExecutor = makeFakeExecutor(commands)
      const result = yield* _(
        runDockerUpIfNeeded(resolvedOutDir, config, {
          runUp: true,
          waitForClone: false,
          waitForAgent: false,
          force: true,
          forceEnv: false
        }).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, recordedExecutor),
          Effect.provideService(FileSystem.FileSystem, fakeFileSystem),
          Effect.provideService(Path.Path, fakePath)
        )
      )

      expect(result).toBeUndefined()

      const downIndex = commands.findIndex(isDownWithRemoveOrphans)
      const rmMainIndex = commands.findIndex(isRmContainer("dg-force-test"))
      const rmBrowserIndex = commands.findIndex(isRmContainer("dg-force-test-browser"))
      const upIndex = commands.findIndex(isUp)

      expect(downIndex).toBeGreaterThanOrEqual(0)
      expect(rmMainIndex).toBeGreaterThan(downIndex)
      expect(rmBrowserIndex).toBeGreaterThan(rmMainIndex)
      expect(upIndex).toBeGreaterThan(rmBrowserIndex)
    })
  )
})
