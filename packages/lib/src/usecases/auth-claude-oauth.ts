import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Duration, Effect, pipe, Schedule } from "effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { writeSync } from "node:fs"

import { AuthError, CommandFailedError } from "../shell/errors.js"
import { readVisibleLine } from "./auth-claude-oauth-input.js"

type ClaudeAuthorizeInfo = {
  readonly authorizeUrl: string
  readonly state: string | null
}

type FirstOutcome =
  | { readonly _tag: "Exit"; readonly exitCode: number }
  | { readonly _tag: "AuthorizeUrl"; readonly info: ClaudeAuthorizeInfo }

const oauthCodeEnvKey = "DOCKER_GIT_CLAUDE_OAUTH_CODE"
const authorizeUrlRegex = /https:\/\/claude\.ai\/oauth\/authorize\S*/u

const extractAuthorizeUrl = (line: string): string | null => {
  const match = authorizeUrlRegex.exec(line)
  return match?.[0] ?? null
}

const readQueryParam = (raw: string, key: string): string | null => {
  const match = new RegExp(String.raw`[?&]${key}=([^&#\s]+)`, "u").exec(raw)
  return match?.[1] ?? null
}

const normalizeOauthPaste = (raw: string, authorizeState: string | null): string => {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return ""
  }
  if (trimmed.includes("#")) {
    return trimmed
  }
  const callbackCode = readQueryParam(trimmed, "code")
  const callbackState = readQueryParam(trimmed, "state")
  if (callbackCode !== null) {
    return callbackState === null ? callbackCode : `${callbackCode}#${callbackState}`
  }
  return authorizeState === null ? trimmed : `${trimmed}#${authorizeState}`
}

const oauthCodeFromEnv = (): string | null => {
  const value = (process.env[oauthCodeEnvKey] ?? "").trim()
  return value.length > 0 ? value : null
}

const ensureInteractiveStdin = (): Effect.Effect<void, AuthError> =>
  process.stdin.isTTY && process.stdout.isTTY
    ? Effect.void
    : Effect.fail(
      new AuthError({
        message:
          `Claude auth login needs an interactive TTY, or set ${oauthCodeEnvKey} to the OAuth Authentication Code.`
      })
    )

const resolveOauthCodeInput = (info: ClaudeAuthorizeInfo): Effect.Effect<string, AuthError> => {
  const fromEnv = oauthCodeFromEnv()
  if (fromEnv !== null) {
    return Effect.succeed(normalizeOauthPaste(fromEnv, info.state))
  }
  return ensureInteractiveStdin().pipe(
    Effect.zipRight(
      readVisibleLine(
        "\n[docker-git] Paste the Authentication Code from the browser and press Enter (Ctrl+C to cancel):\n> "
      )
    ),
    Effect.map((value) => normalizeOauthPaste(value, info.state)),
    Effect.filterOrFail(
      (value) => value.trim().length > 0,
      () => new AuthError({ message: "Claude auth login requires a non-empty Authentication Code." })
    )
  )
}

const writeChunk = (fd: number, chunk: Uint8Array): Effect.Effect<void> =>
  Effect.sync(() => {
    writeSync(fd, chunk)
  }).pipe(Effect.asVoid)

const logLine = (line: string): Effect.Effect<void> =>
  Effect.sync(() => {
    writeSync(1, line.endsWith("\n") ? line : `${line}\n`)
  }).pipe(Effect.asVoid)

const pumpDockerOutput = (
  source: Stream.Stream<Uint8Array, PlatformError>,
  fd: number,
  oauth: Deferred.Deferred<ClaudeAuthorizeInfo>
): Effect.Effect<void, PlatformError> => {
  const decoder = new TextDecoder("utf-8")
  let remainder = ""

  return pipe(
    source,
    Stream.runForEach((chunk) =>
      pipe(
        writeChunk(fd, chunk),
        Effect.zipRight(
          Effect.sync((): ClaudeAuthorizeInfo | null => {
            remainder += decoder.decode(chunk)
            // Keep only a sliding window so repeated scans stay cheap.
            if (remainder.length > 8192) {
              remainder = remainder.slice(-8192)
            }
            const authorizeUrl = extractAuthorizeUrl(remainder)
            if (authorizeUrl === null) {
              return null
            }
            const state = readQueryParam(authorizeUrl, "state")
            return { authorizeUrl, state }
          })
        ),
        Effect.flatMap((info) =>
          info === null
            ? Effect.void
            : Deferred.succeed(oauth, info).pipe(Effect.asVoid)
        ),
        Effect.asVoid
      )
    )
  ).pipe(Effect.asVoid)
}

type DockerLoginSpec = {
  readonly cwd: string
  readonly image: string
  readonly hostPath: string
  readonly containerPath: string
  readonly env: ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
}

const buildDockerLoginSpec = (
  cwd: string,
  accountPath: string,
  image: string,
  containerPath: string
): DockerLoginSpec => ({
  cwd,
  image,
  hostPath: accountPath,
  containerPath,
  env: [`CLAUDE_CONFIG_DIR=${containerPath}`, "BROWSER=echo"],
  args: ["auth", "login"]
})

const buildDockerLoginArgs = (spec: DockerLoginSpec): ReadonlyArray<string> => {
  // NOTE: Claude Code's `auth login` uses an interactive prompt that behaves poorly without a TTY.
  // We still want to programmatically feed the code, so we run `docker` under `script(1)` which allocates a pty.
  const base: Array<string> = ["run", "--rm", "-i", "-t", "-v", `${spec.hostPath}:${spec.containerPath}`]
  for (const entry of spec.env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
  return [...base, spec.image, ...spec.args]
}

const shellQuote = (value: string): string => {
  if (value.length === 0) {
    return "''"
  }
  // POSIX-safe single-quote escaping: ' -> '\'' .
  const singleQuoteEscape = String.raw`'\''`
  return "'".concat(value.replaceAll("'", singleQuoteEscape), "'")
}

const buildDockerLoginCommandString = (spec: DockerLoginSpec): string =>
  ["docker", ...buildDockerLoginArgs(spec)]
    .map((part) => shellQuote(part))
    .join(" ")

const startDockerProcess = (
  executor: CommandExecutor.CommandExecutor,
  spec: DockerLoginSpec
): Effect.Effect<CommandExecutor.Process, PlatformError, Scope.Scope> =>
  executor.start(
    pipe(
      // We run docker via script(1) to get a pseudo-tty even when we need to pipe input from Node.
      Command.make(
        "script",
        "-q",
        "-f",
        "-e",
        "-c",
        buildDockerLoginCommandString(spec),
        "/dev/null"
      ),
      Command.workingDirectory(spec.cwd),
      Command.stdin("pipe"),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
  )

const awaitFirstOutcome = (
  proc: CommandExecutor.Process,
  oauth: Deferred.Deferred<ClaudeAuthorizeInfo>
): Effect.Effect<FirstOutcome, PlatformError> =>
  Effect.race(
    Deferred.await(oauth).pipe(Effect.map((info) => ({ _tag: "AuthorizeUrl" as const, info }))),
    proc.exitCode.pipe(Effect.map((exitCode) => ({ _tag: "Exit" as const, exitCode: Number(exitCode) })))
  )

const ensureExitOk = (exitCode: number): Effect.Effect<void, CommandFailedError> =>
  exitCode === 0 ? Effect.void : Effect.fail(new CommandFailedError({ command: "claude auth login", exitCode }))

const feedOauthCode = (proc: CommandExecutor.Process, code: string): Effect.Effect<void, PlatformError> => {
  const bytes = new TextEncoder().encode(`${code}\n`)
  return pipe(Stream.make(bytes), Stream.run(proc.stdin), Effect.asVoid)
}

const awaitExitCodeWithHeartbeat = (proc: CommandExecutor.Process): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const start = Date.now()
    const heartbeat = yield* _(
      Effect.fork(
        logLine("[docker-git] Waiting for Claude to finish OAuth login (this can be silent for a bit)...").pipe(
          Effect.zipRight(
            Effect.repeat(
              Effect.sync(() => {
                const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000))
                writeSync(1, `[docker-git] Still waiting for Claude... (${seconds}s)\n`)
              }),
              Schedule.addDelay(Schedule.forever, () => Duration.seconds(5))
            )
          )
        )
      )
    )
    return yield* _(
      proc.exitCode.pipe(
        Effect.map(Number),
        Effect.ensuring(Fiber.interrupt(heartbeat).pipe(Effect.ignore))
      )
    )
  })

const finishClaudeLogin = (
  outcome: FirstOutcome,
  proc: CommandExecutor.Process
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError> => {
  if (outcome._tag === "Exit") {
    return ensureExitOk(outcome.exitCode)
  }
  return resolveOauthCodeInput(outcome.info).pipe(
    Effect.flatMap((code) =>
      feedOauthCode(proc, code).pipe(
        Effect.zipRight(
          Effect.sync(() => {
            writeSync(1, "[docker-git] Code submitted, waiting for Claude...\n")
          })
        )
      )
    ),
    Effect.zipRight(awaitExitCodeWithHeartbeat(proc).pipe(Effect.flatMap((exitCode) => ensureExitOk(exitCode)))),
    Effect.asVoid
  )
}

export const runClaudeOauthLoginWithPrompt = (
  cwd: string,
  accountPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const executor = yield* _(CommandExecutor.CommandExecutor)
      const spec = buildDockerLoginSpec(cwd, accountPath, options.image, options.containerPath)
      const proc = yield* _(startDockerProcess(executor, spec))

      const oauth = yield* _(Deferred.make<ClaudeAuthorizeInfo>())
      const stdoutFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stdout, 1, oauth)))
      const stderrFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stderr, 2, oauth)))

      const first = yield* _(awaitFirstOutcome(proc, oauth))
      yield* _(finishClaudeLogin(first, proc))

      yield* _(Fiber.join(stdoutFiber))
      yield* _(Fiber.join(stderrFiber))
    }).pipe(Effect.asVoid)
  )
