import {
  claudeCodeOauthTokenEnvKey,
  dockerGitClaudeOauthTokenEnvKey
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import {
  buildClaudeLocalEnv,
  readClaudeLocalOauthTokenFromEnv,
  runClaudeLocalEnvTokenLoginFlow
} from "../../src/usecases/auth-claude-local.js"

const oauthToken = "sk-ant-oat01-LOCAL0123456789abcdef"

const makeExitCodeExecutor = (
  exitCode: number,
  invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.sync(() => {
      const flattened = Command.flatten(command)
      const invocation = flattened[flattened.length - 1]!
      invocations.push({ command: invocation.command, args: invocation.args })

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "ClaudeLocalTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "ClaudeLocalTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[ClaudeLocalTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("Claude local auth runner", () => {
  it.effect("reads a Claude OAuth token from the local smoke env keys", () =>
    Effect.gen(function*(_) {
      const fromClaudeEnv = yield* _(
        readClaudeLocalOauthTokenFromEnv({
          [claudeCodeOauthTokenEnvKey]: ` ${oauthToken} `
        })
      )
      const fromDockerGitEnv = yield* _(
        readClaudeLocalOauthTokenFromEnv({
          [claudeCodeOauthTokenEnvKey]: "sk-ant-oat01-LOWERPRIORITY0123456789",
          [dockerGitClaudeOauthTokenEnvKey]: oauthToken
        })
      )

      expect(fromClaudeEnv).toBe(oauthToken)
      expect(fromDockerGitEnv).toBe(oauthToken)
    }))

  it.effect("fails without a local smoke token", () =>
    Effect.gen(function*(_) {
      const error = yield* _(readClaudeLocalOauthTokenFromEnv({}).pipe(Effect.flip))
      expect(error._tag).toBe("AuthError")
      expect(error.message).toContain(dockerGitClaudeOauthTokenEnvKey)
      expect(error.message).toContain(claudeCodeOauthTokenEnvKey)
    }))

  it("builds an isolated local Claude CLI environment without exposing unrelated env", () => {
    expect(buildClaudeLocalEnv("/tmp/claude-account", oauthToken)).toEqual({
      CLAUDE_CONFIG_DIR: "/tmp/claude-account",
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
      HOME: "/tmp/claude-account"
    })
  })

  it.effect("runs the shared login flow through the local Claude probe runner", () =>
    Effect.gen(function*(_) {
      const invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = []
      let persisted: string | null = null
      const result = yield* _(
        runClaudeLocalEnvTokenLoginFlow({
          cwd: "/workspace",
          accountLabel: "default",
          accountPath: "/tmp/claude-account",
          env: { [claudeCodeOauthTokenEnvKey]: oauthToken },
          persistToken: (token) => Effect.sync(() => {
            persisted = token
          }),
          normalizeStoredCredentials: Effect.void,
          syncState: Effect.void
        }).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, makeExitCodeExecutor(7, invocations))
        )
      )

      expect(persisted).toBe(oauthToken)
      expect(result.probeStatus).toEqual({ _tag: "ClaudeLoginProbeFailed", exitCode: 7 })
      expect(invocations).toEqual([{ command: "claude", args: ["-p", "ping"] }])
    }))
})
