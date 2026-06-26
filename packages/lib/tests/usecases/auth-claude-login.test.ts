import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { authClaudeLogin } from "../../src/usecases/auth-claude.js"

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const oauthToken = "sk-ant-oat01-EXAMPLE0123456789abcdef"

// Mirrors the real `claude setup-token` output that the OAuth parser scans for.
const setupTokenOutput = (token: string): string =>
  [
    "Welcome to Claude Code",
    "",
    " ✓ Long-lived authentication token created successfully!",
    "",
    " Your OAuth token (valid for 1 year):",
    "",
    ` ${token}`,
    "",
    " Store this token securely. You won't be able to see it again."
  ].join("\n")

const isSetupToken = (args: ReadonlyArray<string>): boolean => args.includes("setup-token")
const isPingProbe = (args: ReadonlyArray<string>): boolean => args.includes("-p") && args.includes("ping")

// CHANGE: fake docker executor that captures a setup-token and lets the ping probe fail
// WHY: reproduce issue-439 where a successful OAuth login was discarded by a failing probe
// REF: issue-439
const makeFakeExecutor = (
  token: string,
  pingExitCode: number
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.sync(() => {
      const flattened = Command.flatten(command)
      const invocation = flattened[flattened.length - 1]!
      const args = invocation.args

      const stdoutText = isSetupToken(args) ? setupTokenOutput(token) : ""
      const exitCode = isPingProbe(args) ? pingExitCode : 0
      const stdout = stdoutText.length === 0 ? Stream.empty : Stream.succeed(encode(stdoutText))

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({ _tag: "ClaudeLoginTestProcess", command: invocation.command, args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "ClaudeLoginTestProcess",
          command: invocation.command,
          args
        }),
        toString: () => `[ClaudeLoginTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-auth-claude-" }))
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

const runLoginAndReadToken = (
  root: string,
  pingExitCode: number
): Effect.Effect<string, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")

    yield* _(
      authClaudeLogin({
        _tag: "AuthClaudeLogin",
        label: null,
        claudeAuthPath
      }).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, pingExitCode))
      )
    )

    return yield* _(fs.readFileString(path.join(claudeAuthPath, "default", ".oauth-token")))
  })

describe("authClaudeLogin", () => {
  // Regression for issue-439: a non-zero probe exit must not discard a created token.
  it.effect("persists the OAuth token even when the post-login API probe fails", () =>
    withTempDir((root) =>
      withPatchedEnv(
        { HOME: root, DOCKER_GIT_STATE_AUTO_SYNC: "0", DOCKER_GIT_PROJECTS_ROOT: undefined },
        Effect.gen(function*(_) {
          const persisted = yield* _(runLoginAndReadToken(root, 7))
          expect(persisted.trim()).toBe(oauthToken)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("persists the OAuth token when the post-login API probe succeeds", () =>
    withTempDir((root) =>
      withPatchedEnv(
        { HOME: root, DOCKER_GIT_STATE_AUTO_SYNC: "0", DOCKER_GIT_PROJECTS_ROOT: undefined },
        Effect.gen(function*(_) {
          const persisted = yield* _(runLoginAndReadToken(root, 0))
          expect(persisted.trim()).toBe(oauthToken)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))
})
