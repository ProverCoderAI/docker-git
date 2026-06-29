import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import {
  type ClaudeDockerOauthResult,
  type ClaudeDockerProbeSpec,
  type ClaudeDockerSetupTokenSpec,
  runClaudeDockerOauth
} from "@prover-coder-ai/docker-git-auth-oauth/claude-docker-oauth"
import {
  dockerGitClaudeOauthTokenEnvKey,
  extractClaudeOauthToken,
  readClaudeOauthTokenFromEnv
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { Effect, pipe } from "effect"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

import { writeChunkToFd } from "../shell/ansi-strip.js"
import { resolveDockerVolumeHostPath } from "../shell/docker-auth.js"
import { AuthError, CommandFailedError } from "../shell/errors.js"

const outputWindowSize = 262_144

const startDockerProcess = (
  executor: CommandExecutor.CommandExecutor,
  cwd: string,
  dockerCommand: string,
  args: ReadonlyArray<string>
): Effect.Effect<CommandExecutor.Process, PlatformError, Scope.Scope> => {
  return executor.start(
    pipe(
      Command.make(dockerCommand, ...args),
      Command.workingDirectory(cwd),
      Command.stdin("inherit"),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
  )
}

const redactedOauthTokenText = (text: string): string =>
  text.replaceAll(/sk-ant-[A-Za-z0-9._-]+/gu, "<redacted-oauth-token>")

const pumpDockerOutput = (
  source: Stream.Stream<Uint8Array, PlatformError>,
  fd: number,
  tokenBox: { value: string | null }
): Effect.Effect<void, PlatformError> => {
  const decoder = new TextDecoder("utf-8")
  let outputWindow = ""

  return pipe(
    source,
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        const text = decoder.decode(chunk)
        writeChunkToFd(fd, new TextEncoder().encode(redactedOauthTokenText(text)))
        outputWindow += text
        if (outputWindow.length > outputWindowSize) {
          outputWindow = outputWindow.slice(-outputWindowSize)
        }
        if (tokenBox.value !== null) {
          return
        }
        const parsed = extractClaudeOauthToken(outputWindow)
        if (parsed !== null) {
          tokenBox.value = parsed
        }
      }).pipe(Effect.asVoid)
    )
  ).pipe(Effect.asVoid)
}

const pipeDockerOutputToFd = (
  source: Stream.Stream<Uint8Array, PlatformError>,
  fd: 1 | 2
): Effect.Effect<void, PlatformError> =>
  pipe(
    source,
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        writeChunkToFd(fd, chunk)
      })
    )
  ).pipe(Effect.asVoid)

const runDockerSetupTokenWithExecutor = (
  executor: CommandExecutor.CommandExecutor,
  spec: ClaudeDockerSetupTokenSpec
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*(_) {
        const proc = yield* _(startDockerProcess(executor, spec.cwd, spec.dockerCommand, spec.args))
        const tokenBox: { value: string | null } = { value: null }
        const stdoutFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stdout, 1, tokenBox)))
        const stderrFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stderr, 2, tokenBox)))
        const exitCode = yield* _(proc.exitCode.pipe(Effect.map(Number)))
        yield* _(Fiber.join(stdoutFiber))
        yield* _(Fiber.join(stderrFiber))
        return { exitCode, token: tokenBox.value }
      })
    )
  )

const runDockerProbeWithExecutor = (
  executor: CommandExecutor.CommandExecutor,
  spec: ClaudeDockerProbeSpec
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*(_) {
        const proc = yield* _(startDockerProcess(executor, spec.cwd, spec.dockerCommand, spec.args))
        const stdoutFiber = yield* _(Effect.forkScoped(pipeDockerOutputToFd(proc.stdout, 1)))
        const stderrFiber = yield* _(Effect.forkScoped(pipeDockerOutputToFd(proc.stderr, 2)))
        const exitCode = yield* _(proc.exitCode.pipe(Effect.map(Number)))
        yield* _(Fiber.join(stdoutFiber))
        yield* _(Fiber.join(stderrFiber))
        return exitCode
      })
    )
  )

const runClaudeDockerOauthEffect = (
  cwd: string,
  accountPath: string,
  hostPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  },
  executor: CommandExecutor.CommandExecutor
): Effect.Effect<ClaudeDockerOauthResult, AuthError> =>
  Effect.tryPromise({
    try: () =>
      runClaudeDockerOauth({
        cwd,
        accountPath,
        dockerHostPath: hostPath,
        image: options.image,
        containerPath: options.containerPath,
        skipBuild: true,
        keepAccountPath: true,
        printToken: false,
        runSetupToken: (spec) => runDockerSetupTokenWithExecutor(executor, spec),
        runProbe: (spec) => runDockerProbeWithExecutor(executor, spec)
      }),
    catch: (error) =>
      new AuthError({
        message: error instanceof Error ? error.message : "Claude Docker OAuth failed."
      })
  })

const resolveClaudeDockerOauthTokenResult = (
  result: ClaudeDockerOauthResult
): Effect.Effect<string, AuthError | CommandFailedError> =>
  Effect.gen(function*(_) {
    if (result._tag === "ClaudeDockerOauthTokenCaptured") {
      if (result.exitCode !== 0) {
        yield* _(
          Effect.logWarning(
            `claude setup-token returned exit=${result.exitCode}, but OAuth token was captured; continuing.`
          )
        )
      }
      return result.token
    }
    if (result._tag === "ClaudeDockerOauthCommandFailed") {
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "claude setup-token", exitCode: result.exitCode }))
      )
    }
    return yield* _(
      Effect.fail(
        new AuthError({
          message:
            "Claude OAuth completed without a captured token. Retry login and ensure the flow reaches 'Long-lived authentication token created successfully'."
        })
      )
    )
  })

export const runClaudeOauthLoginWithPrompt = (
  cwd: string,
  accountPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<string, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const envToken = readClaudeOauthTokenFromEnv(process.env, [dockerGitClaudeOauthTokenEnvKey])
  if (envToken !== null) {
    return Effect.succeed(envToken)
  }

  return Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath))
      const result = yield* _(runClaudeDockerOauthEffect(cwd, accountPath, hostPath, options, executor))
      return yield* _(resolveClaudeDockerOauthTokenResult(result))
    })
  )
}
