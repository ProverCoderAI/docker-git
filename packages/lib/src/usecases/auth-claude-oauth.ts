import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import {
  type ClaudeDockerOauthResult,
  type ClaudeDockerProbeSpec,
  type ClaudeDockerSetupTokenRunResult,
  type ClaudeDockerSetupTokenSpec,
  runClaudeDockerOauth
} from "@prover-coder-ai/docker-git-auth-oauth/claude-docker-oauth"
import {
  extractClaudeOauthToken,
  flushClaudeOauthTokenRedactionState,
  initialClaudeOauthTokenRedactionState,
  redactClaudeOauthTokenChunk
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

const pumpDockerOutput = (
  source: Stream.Stream<Uint8Array, PlatformError>,
  fd: number,
  tokenBox: { value: string | null }
): Effect.Effect<void, PlatformError> => {
  const decoder = new TextDecoder("utf-8")
  const encoder = new TextEncoder()
  let outputWindow = ""
  let redactionState = initialClaudeOauthTokenRedactionState

  return pipe(
    source,
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        const text = decoder.decode(chunk)
        const redacted = redactClaudeOauthTokenChunk(redactionState, text)
        redactionState = redacted.state
        if (redacted.output.length > 0) {
          writeChunkToFd(fd, encoder.encode(redacted.output))
        }
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
  ).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        const flushed = flushClaudeOauthTokenRedactionState(redactionState)
        if (flushed.length > 0) {
          writeChunkToFd(fd, encoder.encode(flushed))
        }
      })
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
): Effect.Effect<ClaudeDockerSetupTokenRunResult, PlatformError> =>
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

const runDockerProbeWithExecutor = (
  executor: CommandExecutor.CommandExecutor,
  spec: ClaudeDockerProbeSpec
): Effect.Effect<number, PlatformError> =>
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
        runSetupToken: (spec) => Effect.runPromise(runDockerSetupTokenWithExecutor(executor, spec)),
        runProbe: (spec) => Effect.runPromise(runDockerProbeWithExecutor(executor, spec))
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
      if (result.probeStatus._tag === "ClaudeDockerProbeFailed") {
        yield* _(
          Effect.logWarning(
            `claude -p ping failed with exit=${result.probeStatus.exitCode}; OAuth token was saved. Run docker-git auth claude status to verify later.`
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
    readonly envToken: string | null
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<string, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  if (options.envToken !== null) {
    return Effect.succeed(options.envToken)
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
