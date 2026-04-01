import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

import { stripAnsi, writeChunkToFd } from "../shell/ansi-strip.js"
import { resolveDefaultDockerUser, resolveDockerVolumeHostPath } from "../shell/docker-auth.js"
import { AuthError, CommandFailedError } from "../shell/errors.js"

const oauthTokenEnvKey = "DOCKER_GIT_CLAUDE_OAUTH_TOKEN"
const tokenMarker = "Your OAuth token (valid for 1 year):"
const tokenFooterMarker = "Store this token securely."
const outputWindowSize = 262_144

const oauthTokenRegex = /([A-Za-z0-9][A-Za-z0-9._-]{20,})/u

const extractOauthToken = (rawOutput: string): string | null => {
  const normalized = stripAnsi(rawOutput).replaceAll("\r", "\n")
  const markerIndex = normalized.lastIndexOf(tokenMarker)
  if (markerIndex === -1) {
    return null
  }

  const tail = normalized.slice(markerIndex + tokenMarker.length)
  const footerIndex = tail.indexOf(tokenFooterMarker)
  const tokenSection = footerIndex === -1 ? tail : tail.slice(0, footerIndex)

  // CHANGE: join wrapped lines in token section before parsing
  // WHY: some terminals hard-wrap long OAuth tokens with newline characters
  // REF: issue-377
  // SOURCE: n/a
  // PURITY: CORE
  // INVARIANT: only whitespace is removed; token alphabet remains intact
  const compactSection = tokenSection.replaceAll(/\s+/gu, "")
  const compactMatch = oauthTokenRegex.exec(compactSection)
  if (compactMatch?.[1] !== undefined) {
    return compactMatch[1]
  }

  const directMatch = oauthTokenRegex.exec(tokenSection)
  return directMatch?.[1] ?? null
}

const oauthTokenFromEnv = (): string | null => {
  const value = (process.env[oauthTokenEnvKey] ?? "").trim()
  return value.length > 0 ? value : null
}

const ensureOauthToken = (rawToken: string): Effect.Effect<string, AuthError> => {
  const token = rawToken.trim()
  return token.length > 0
    ? Effect.succeed(token)
    : Effect.fail(new AuthError({ message: "Claude OAuth token is empty." }))
}

type DockerSetupTokenSpec = {
  readonly cwd: string
  readonly image: string
  readonly hostPath: string
  readonly containerPath: string
  readonly env: ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
}

const buildDockerSetupTokenSpec = (
  cwd: string,
  accountPath: string,
  image: string,
  containerPath: string
): DockerSetupTokenSpec => ({
  cwd,
  image,
  hostPath: accountPath,
  containerPath,
  env: [`CLAUDE_CONFIG_DIR=${containerPath}`, `HOME=${containerPath}`, "BROWSER=echo"],
  args: ["setup-token"]
})

const buildDockerSetupTokenArgs = (spec: DockerSetupTokenSpec): ReadonlyArray<string> => {
  const base: Array<string> = ["run", "--rm", "-i", "-t", "-v", `${spec.hostPath}:${spec.containerPath}`]
  const dockerUser = resolveDefaultDockerUser()
  if (dockerUser !== null) {
    base.push("--user", dockerUser)
  }
  for (const entry of spec.env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
  return [...base, spec.image, ...spec.args]
}

const startDockerProcess = (
  executor: CommandExecutor.CommandExecutor,
  spec: DockerSetupTokenSpec
): Effect.Effect<CommandExecutor.Process, PlatformError, Scope.Scope> =>
  executor.start(
    pipe(
      Command.make("docker", ...buildDockerSetupTokenArgs(spec)),
      Command.workingDirectory(spec.cwd),
      Command.stdin("inherit"),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
  )

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
        writeChunkToFd(fd, chunk)
        outputWindow += decoder.decode(chunk)
        if (outputWindow.length > outputWindowSize) {
          outputWindow = outputWindow.slice(-outputWindowSize)
        }
        if (tokenBox.value !== null) {
          return
        }
        const parsed = extractOauthToken(outputWindow)
        if (parsed !== null) {
          tokenBox.value = parsed
        }
      }).pipe(Effect.asVoid)
    )
  ).pipe(Effect.asVoid)
}

const resolveCapturedToken = (token: string | null): Effect.Effect<string, AuthError> =>
  token === null
    ? Effect.fail(
      new AuthError({
        message:
          "Claude OAuth completed without a captured token. Retry login and ensure the flow reaches 'Long-lived authentication token created successfully'."
      })
    )
    : ensureOauthToken(token)

const resolveLoginResult = (
  token: string | null,
  exitCode: number
): Effect.Effect<string, AuthError | CommandFailedError> =>
  Effect.gen(function*(_) {
    if (token !== null) {
      if (exitCode !== 0) {
        yield* _(
          Effect.logWarning(
            `claude setup-token returned exit=${exitCode}, but OAuth token was captured; continuing.`
          )
        )
      }
      return yield* _(ensureOauthToken(token))
    }

    if (exitCode !== 0) {
      yield* _(Effect.fail(new CommandFailedError({ command: "claude setup-token", exitCode })))
    }

    return yield* _(resolveCapturedToken(token))
  })

export const runClaudeOauthLoginWithPrompt = (
  cwd: string,
  accountPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<string, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const envToken = oauthTokenFromEnv()
  if (envToken !== null) {
    return ensureOauthToken(envToken)
  }

  return Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath))
      const spec = buildDockerSetupTokenSpec(cwd, hostPath, options.image, options.containerPath)
      const proc = yield* _(startDockerProcess(executor, spec))

      const tokenBox: { value: string | null } = { value: null }
      const stdoutFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stdout, 1, tokenBox)))
      const stderrFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stderr, 2, tokenBox)))

      const exitCode = yield* _(proc.exitCode.pipe(Effect.map(Number)))
      yield* _(Fiber.join(stdoutFiber))
      yield* _(Fiber.join(stderrFiber))
      return yield* _(resolveLoginResult(tokenBox.value, exitCode))
    })
  )
}
