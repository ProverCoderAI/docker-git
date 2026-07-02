import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import {
  claudeOauthTokenFileMode,
  dockerGitClaudeOauthTokenEnvKey
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import { authClaudeLogin, authClaudeStatus } from "../../src/usecases/auth-claude.js"

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const oauthToken = "sk-ant-oat01-TESTCLAUDEOAUTH0123456789"

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

const setupTokenOutputWithoutToken = (): string =>
  [
    "Welcome to Claude Code",
    "",
    " OAuth flow finished without printing a long-lived token.",
    ""
  ].join("\n")

const isSetupToken = (args: ReadonlyArray<string>): boolean => args.includes("setup-token")
const isPingProbe = (args: ReadonlyArray<string>): boolean => args.includes("-p") && args.includes("ping")
const dockerEnvEntries = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.flatMap((arg, index) => args[index - 1] === "-e" ? [arg] : [])
const dockerEnvFileEntries = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.flatMap((arg, index) => args[index - 1] === "--env-file" ? [arg] : [])
const dockerTmpfsEntries = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.flatMap((arg, index) => args[index - 1] === "--tmpfs" ? [arg] : [])

// CHANGE: fake docker executor that captures a setup-token and lets the ping probe fail
// WHY: reproduce issue-439 where a successful OAuth login was discarded by a failing probe
// REF: issue-439
const makeFakeExecutor = (
  token: string | null,
  pingExitCode: number,
  invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = []
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.sync(() => {
      const flattened = Command.flatten(command)
      const invocation = flattened[flattened.length - 1]!
      const args = invocation.args
      invocations.push({ command: invocation.command, args })

      const stdoutText = isSetupToken(args)
        ? token === null
          ? setupTokenOutputWithoutToken()
          : setupTokenOutput(token)
        : ""
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
): Effect.Effect<
  { readonly logs: ReadonlyArray<string>; readonly tokenText: string },
  unknown,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const logs: Array<string> = []
    const logger = Logger.make(({ message }) => {
      logs.push(String(message))
    })
    const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")

    yield* _(
      authClaudeLogin({
        _tag: "AuthClaudeLogin",
        label: null,
        claudeAuthPath
      }).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, pingExitCode)),
        Effect.provide(Logger.replace(Logger.defaultLogger, logger))
      )
    )

    const tokenText = yield* _(fs.readFileString(path.join(claudeAuthPath, "default", ".oauth-token")))
    return { logs, tokenText }
  })

const runLoginWithoutCapturedToken = (
  root: string
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")
    const tokenPath = path.join(claudeAuthPath, "default", ".oauth-token")

    const error = yield* _(
      authClaudeLogin({
        _tag: "AuthClaudeLogin",
        label: null,
        claudeAuthPath
      }).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(null, 0)),
        Effect.flip
      )
    )

    expect(error._tag).toBe("AuthError")
    if (error._tag === "AuthError") {
      expect(error.message).toContain("without a captured token")
    }
    const hasTokenFile = yield* _(fs.exists(tokenPath))
    expect(hasTokenFile).toBe(false)
  })

describe("authClaudeLogin", () => {
  // Regression for issue-439: a non-zero probe exit must not discard a created token.
  it.effect("persists the OAuth token even when the post-login API probe fails", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          const { logs, tokenText } = yield* _(runLoginAndReadToken(root, 7))
          expect(tokenText.trim()).toBe(oauthToken)
          expect(logs.some((message) => message.includes("claude -p ping failed with exit=7"))).toBe(true)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("persists the OAuth token when the post-login API probe succeeds", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          const { tokenText } = yield* _(runLoginAndReadToken(root, 0))
          expect(tokenText.trim()).toBe(oauthToken)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("ignores docker-git OAuth env token and captures setup-token output", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: "ENV_CLAUDE_OAUTH_TOKEN_SHOULD_NOT_WIN"
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = []
          const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")

          yield* _(
            authClaudeLogin({
              _tag: "AuthClaudeLogin",
              label: null,
              claudeAuthPath
            }).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, 0, invocations))
            )
          )

          const tokenText = yield* _(fs.readFileString(path.join(claudeAuthPath, "default", ".oauth-token")))
          expect(tokenText.trim()).toBe(oauthToken)
          expect(tokenText.trim()).not.toBe("ENV_CLAUDE_OAUTH_TOKEN_SHOULD_NOT_WIN")
          expect(invocations.some((invocation) => isSetupToken(invocation.args))).toBe(true)
          expect(invocations.some((invocation) => isPingProbe(invocation.args))).toBe(true)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("runs the OAuth probe with a clean config dir instead of account permission settings", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = []
          const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")
          const accountPath = path.join(claudeAuthPath, "default")

          yield* _(fs.makeDirectory(accountPath, { recursive: true }))
          yield* _(
            fs.writeFileString(
              path.join(accountPath, "settings.json"),
              JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }, null, 2)
            )
          )

          yield* _(
            authClaudeLogin({
              _tag: "AuthClaudeLogin",
              label: null,
              claudeAuthPath
            }).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, 0, invocations))
            )
          )

          const pingInvocation = invocations.find((invocation) => isPingProbe(invocation.args))
          expect(pingInvocation).toBeDefined()
          if (pingInvocation === undefined) {
            return
          }

          const envEntries = dockerEnvEntries(pingInvocation.args)
          expect(envEntries).toContain("HOME=/claude-probe-home")
          expect(envEntries).toContain("CLAUDE_CONFIG_DIR=/claude-probe-home")
          expect(envEntries.some((entry) => entry.startsWith("CLAUDE_CODE_OAUTH_TOKEN="))).toBe(false)
          expect(dockerEnvFileEntries(pingInvocation.args)).toHaveLength(1)
          expect(dockerTmpfsEntries(pingInvocation.args)).toContain("/claude-probe-home:rw,size=16m,mode=1777")
          expect(pingInvocation.args.join(" ")).not.toContain(oauthToken)
          expect(envEntries).not.toContain("HOME=/claude-home")
          expect(envEntries).not.toContain("CLAUDE_CONFIG_DIR=/claude-home")
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("keeps Claude AI session status probes on the mounted account config", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const invocations: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = []
          const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")
          const accountPath = path.join(claudeAuthPath, "default")

          yield* _(fs.makeDirectory(accountPath, { recursive: true }))
          yield* _(fs.writeFileString(path.join(accountPath, ".credentials.json"), "{\"session\":\"ok\"}\n"))

          yield* _(
            authClaudeStatus({
              _tag: "AuthClaudeStatus",
              label: null,
              claudeAuthPath
            }).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, 0, invocations))
            )
          )

          const pingInvocation = invocations.find((invocation) => isPingProbe(invocation.args))
          expect(pingInvocation).toBeDefined()
          if (pingInvocation === undefined) {
            return
          }

          const envEntries = dockerEnvEntries(pingInvocation.args)
          expect(envEntries).toContain("HOME=/claude-home")
          expect(envEntries).toContain("CLAUDE_CONFIG_DIR=/claude-home")
          expect(envEntries.some((entry) => entry.startsWith("CLAUDE_CODE_OAUTH_TOKEN="))).toBe(false)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("replaces an existing token symlink without writing the secret to the symlink target", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const claudeAuthPath = path.join(root, ".docker-git/.orch/auth/claude")
          const accountPath = path.join(claudeAuthPath, "default")
          const tokenPath = path.join(accountPath, ".oauth-token")
          const outsidePath = path.join(root, "outside-token-target")
          yield* _(fs.makeDirectory(accountPath, { recursive: true }))
          yield* _(fs.writeFileString(outsidePath, "outside-sentinel\n"))
          yield* _(fs.symlink(outsidePath, tokenPath))
          let finalTokenWrites = 0
          const guardedFs: FileSystem.FileSystem = {
            ...fs,
            writeFileString: (targetPath, data, options) =>
              (targetPath === tokenPath
                ? Effect.sync(() => {
                  finalTokenWrites += 1
                })
                : Effect.void).pipe(
                Effect.zipRight(fs.writeFileString(targetPath, data, options))
              )
          }

          yield* _(
            authClaudeLogin({
              _tag: "AuthClaudeLogin",
              label: null,
              claudeAuthPath
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, guardedFs),
              Effect.provideService(CommandExecutor.CommandExecutor, makeFakeExecutor(oauthToken, 0))
            )
          )

          const outsideText = yield* _(fs.readFileString(outsidePath))
          const tokenText = yield* _(fs.readFileString(tokenPath))
          const tokenInfo = yield* _(fs.stat(tokenPath))

          expect(outsideText).toBe("outside-sentinel\n")
          expect(tokenText.trim()).toBe(oauthToken)
          expect(tokenInfo.type).toBe("File")
          expect(Number(tokenInfo.mode) & 0o777).toBe(claudeOauthTokenFileMode)
          expect(finalTokenWrites).toBe(0)
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("fails when setup-token completes without a captured OAuth token", () =>
    withTempDir((root) =>
      withPatchedEnv(
        {
          HOME: root,
          DOCKER_GIT_STATE_AUTO_SYNC: "0",
          DOCKER_GIT_PROJECTS_ROOT: undefined,
          [dockerGitClaudeOauthTokenEnvKey]: undefined
        },
        Effect.gen(function*(_) {
          yield* _(runLoginWithoutCapturedToken(root))
        })
      )
    ).pipe(Effect.provide(NodeContext.layer)))
})
