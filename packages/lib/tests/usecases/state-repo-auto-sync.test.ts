import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { autoSyncState } from "../../src/usecases/state-repo.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

type DecideExitCode = (command: RecordedCommand) => number

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-state-auto-sync-" }))
      return yield* _(use(tempDir))
    })
  )

const withPatchedEnv = <A, E, R>(
  patch: Readonly<Record<string, string | undefined>>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(patch)) {
        previous.set(key, process.env[key])
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous.entries()) {
          if (value === undefined) {
            delete process.env[key]
          } else {
            process.env[key] = value
          }
        }
      })
  )

const makeFakeExecutor = (
  recorded: Array<RecordedCommand>,
  decideExitCode: DecideExitCode = () => 0
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.sync(() => {
      const flattened = Command.flatten(command)
      const invocation = flattened[flattened.length - 1]!
      const recordedCommand: RecordedCommand = { command: invocation.command, args: invocation.args }
      recorded.push(recordedCommand)

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(decideExitCode(recordedCommand))),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "StateAutoSyncTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "StateAutoSyncTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[StateAutoSyncTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const mutatingSyncGitCommands: ReadonlySet<string> = new Set(["add", "rm", "commit", "fetch", "push", "reset", "stash"])

const isMutatingSyncGitCommand = (command: RecordedCommand): boolean =>
  command.command === "git" && mutatingSyncGitCommands.has(command.args[0] ?? "")

describe("state repo auto sync", () => {
  it.effect("skips non-strict auto-sync before git add when the git index is locked", () =>
    withTempDir((home) =>
      withPatchedEnv(
        {
          HOME: home,
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          DOCKER_GIT_STATE_AUTO_SYNC: "1",
          DOCKER_GIT_STATE_AUTO_SYNC_STRICT: undefined
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const root = path.join(home, ".docker-git")
          const indexLockPath = path.join(root, ".git", "index.lock")
          const recorded: Array<RecordedCommand> = []
          const logs: Array<string> = []
          const logger = Logger.make(({ message }) => {
            logs.push(String(message))
          })

          yield* _(fs.makeDirectory(path.join(root, ".git"), { recursive: true }))
          yield* _(fs.writeFileString(indexLockPath, "locked\n"))

          yield* _(
            autoSyncState("chore(state): test").pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(recorded)),
              Effect.provide(Logger.replace(Logger.defaultLogger, logger))
            )
          )

          expect(recorded.filter(isMutatingSyncGitCommand)).toEqual([])
          expect(logs.some((message) => message.includes("State auto-sync skipped: git index lock exists"))).toBe(true)
          expect(yield* _(fs.exists(`${root}.lock`))).toBe(false)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("releases the state lock when non-strict auto-sync logs a git failure", () =>
    withTempDir((home) =>
      withPatchedEnv(
        {
          HOME: home,
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          DOCKER_GIT_STATE_AUTO_SYNC: "1",
          DOCKER_GIT_STATE_AUTO_SYNC_STRICT: undefined
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const root = path.join(home, ".docker-git")
          const recorded: Array<RecordedCommand> = []
          const logs: Array<string> = []
          const logger = Logger.make(({ message }) => {
            logs.push(String(message))
          })

          yield* _(fs.makeDirectory(path.join(root, ".git"), { recursive: true }))

          yield* _(
            autoSyncState("chore(state): test").pipe(
              Effect.provideService(
                CommandExecutor.CommandExecutor,
                makeFakeExecutor(recorded, (command) =>
                  command.command === "git" && command.args[0] === "rm" ? 23 : 0
                )
              ),
              Effect.provide(Logger.replace(Logger.defaultLogger, logger))
            )
          )

          expect(recorded.some((command) => command.command === "git" && command.args[0] === "rm")).toBe(true)
          expect(logs.some((message) => message.includes("State auto-sync failed: git rm (exit 23)"))).toBe(true)
          expect(yield* _(fs.exists(`${root}.lock`))).toBe(false)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))
})
