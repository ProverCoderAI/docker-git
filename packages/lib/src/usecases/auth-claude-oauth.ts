import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { writeSync } from "node:fs"
import * as Readline from "node:readline"

import { AuthError, CommandFailedError } from "../shell/errors.js"

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

const readLine = (prompt: string): Effect.Effect<string, AuthError> =>
  Effect.async<string, AuthError>((resume) => {
    // We intentionally use readline (not raw mode) so paste works reliably in common terminals.
    const hasRawMode = process.stdin.isTTY && typeof process.stdin.setRawMode === "function"
    const previousRaw = hasRawMode ? process.stdin.isRaw : undefined
    if (hasRawMode) {
      process.stdin.setRawMode(false)
    }

    const rl = Readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })

    let settled = false

    const cleanup = () => {
      rl.removeAllListeners()
      rl.close()
      if (hasRawMode && previousRaw !== undefined) {
        process.stdin.setRawMode(previousRaw)
      }
    }

    rl.on("SIGINT", () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.fail(new AuthError({ message: "Claude auth login cancelled." })))
    })

    writeSync(1, prompt)
    rl.question("", (answer) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.succeed(answer))
    })

    return Effect.sync(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
    })
  })

const resolveOauthCodeInput = (info: ClaudeAuthorizeInfo): Effect.Effect<string, AuthError> => {
  const fromEnv = oauthCodeFromEnv()
  if (fromEnv !== null) {
    return Effect.succeed(normalizeOauthPaste(fromEnv, info.state))
  }
  return ensureInteractiveStdin().pipe(
    Effect.zipRight(
      readLine(
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
  // NOTE: We intentionally avoid `-t` here.
  // We need stdin as a pipe (to feed the OAuth code), and `docker run -t` errors when stdin isn't a real TTY.
  const base: Array<string> = ["run", "--rm", "-i", "-v", `${spec.hostPath}:${spec.containerPath}`]
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
  spec: DockerLoginSpec
): Effect.Effect<CommandExecutor.Process, PlatformError, Scope.Scope> =>
  executor.start(
    pipe(
      Command.make("docker", ...buildDockerLoginArgs(spec)),
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
    Effect.zipRight(proc.exitCode.pipe(Effect.map(Number), Effect.flatMap((exitCode) => ensureExitOk(exitCode)))),
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
