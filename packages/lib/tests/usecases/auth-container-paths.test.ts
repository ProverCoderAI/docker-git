import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { authCodexLogin } from "../../src/usecases/auth-codex.js"
import { authGithubLogin } from "../../src/usecases/auth-github.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-auth-paths-"
        })
      )
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

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(cwd)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.chdir(previous)
      })
  )

const includesArgsInOrder = (
  args: ReadonlyArray<string>,
  expectedSequence: ReadonlyArray<string>
): boolean => {
  let searchFrom = 0
  for (const expected of expectedSequence) {
    const foundAt = args.indexOf(expected, searchFrom)
    if (foundAt === -1) {
      return false
    }
    searchFrom = foundAt + 1
  }
  return true
}

const isDockerRunFor = (
  entry: RecordedCommand,
  image: string,
  args: ReadonlyArray<string>
): boolean =>
  entry.command === "docker" &&
  includesArgsInOrder(entry.args, ["run", "--rm"]) &&
  includesArgsInOrder(entry.args, [image, ...args])

const makeFakeExecutor = (
  recorded: Array<RecordedCommand>
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const last = flattened[flattened.length - 1]!
      const invocation: RecordedCommand = { command: last.command, args: last.args }
      const stdoutText = isDockerRunFor(invocation, "docker-git-auth-gh:latest", ["auth", "token"])
        ? "test-gh-token\n"
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
        toJSON: () => ({ _tag: "AuthContainerPathsTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "AuthContainerPathsTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[AuthContainerPathsTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("auth container paths", () => {
  it.effect("pins gh auth login and token reads to the same writable config dir", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const envPath = `${root}/.docker-git/.orch/env/global.env`
        const accountPath = `${root}/.docker-git/.orch/auth/gh/default`
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)

        yield* _(
          withPatchedEnv(
            {
              HOME: root,
              DOCKER_GIT_STATE_AUTO_SYNC: "0"
            },
            withWorkingDirectory(
              root,
              authGithubLogin({
                _tag: "AuthGithubLogin",
                label: null,
                token: null,
                scopes: null,
                envGlobalPath: ".docker-git/.orch/env/global.env"
              }).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor))
            )
          )
        )

        const loginCommand = recorded.find((entry) =>
          isDockerRunFor(entry, "docker-git-auth-gh:latest", ["auth", "login"])
        )
        const tokenCommand = recorded.find((entry) =>
          isDockerRunFor(entry, "docker-git-auth-gh:latest", ["auth", "token"])
        )

        expect(loginCommand).toBeDefined()
        expect(tokenCommand).toBeDefined()
        expect(
          includesArgsInOrder(loginCommand?.args ?? [], [
            "--mount",
            `type=bind,source=${accountPath},target=/gh-auth`,
            "-e",
            "BROWSER=echo",
            "-e",
            "GH_CONFIG_DIR=/gh-auth",
            "docker-git-auth-gh:latest",
            "auth",
            "login"
          ])
        ).toBe(true)
        expect(
          includesArgsInOrder(tokenCommand?.args ?? [], [
            "--mount",
            `type=bind,source=${accountPath},target=/gh-auth`,
            "-e",
            "GH_CONFIG_DIR=/gh-auth",
            "docker-git-auth-gh:latest",
            "auth",
            "token"
          ])
        ).toBe(true)

        const envText = yield* _(fs.readFileString(envPath))
        expect(envText).toContain("GITHUB_TOKEN=test-gh-token")
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("runs codex auth against a non-root CODEX_HOME mount", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)

        yield* _(
          withPatchedEnv(
            {
              HOME: root,
              DOCKER_GIT_STATE_AUTO_SYNC: "0"
            },
            withWorkingDirectory(
              root,
              authCodexLogin({
                _tag: "AuthCodexLogin",
                label: null,
                codexAuthPath: ".docker-git/.orch/auth/codex"
              }).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor))
            )
          )
        )

        const loginCommand = recorded.find((entry) =>
          isDockerRunFor(entry, "docker-git-auth-codex:latest", ["codex", "login", "--device-auth"])
        )

        expect(loginCommand).toBeDefined()
        expect(
          loginCommand?.args.some((arg) => arg.endsWith(",target=/codex-home")) ?? false
        ).toBe(true)
        expect(loginCommand?.args.includes("CODEX_HOME=/codex-home") ?? false).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
