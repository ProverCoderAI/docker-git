import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Deferred, Effect, pipe } from "effect"
import * as Fiber from "effect/Fiber"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

import { stripAnsi, writeChunkToFd } from "../shell/ansi-strip.js"
import { runCommandCapture, runCommandExitCode } from "../shell/command-runner.js"
import { resolveDockerVolumeHostPath } from "../shell/docker-auth.js"
import { AuthError, CommandFailedError } from "../shell/errors.js"

// CHANGE: add Gemini CLI OAuth authentication flow
// WHY: enable Gemini CLI OAuth login in headless/Docker environments
// QUOTE(ТЗ): "Мне надо что бы он её умел принимать, типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment from skulidropek
// SOURCE: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts
// FORMAT THEOREM: forall cmd: runGeminiOauthLogin(cmd) -> oauth_credentials_stored | error
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: OAuth credentials are stored in ~/.gemini directory within account path
// COMPLEXITY: O(command)

type GeminiAuthResult = "success" | "failure" | "pending"

const outputWindowSize = 262_144

// Detect successful authentication in Gemini CLI output
const authSuccessPatterns = [
  "Authentication succeeded",
  "Authentication successful",
  "Successfully authenticated",
  "Logged in as",
  "You are now logged in"
]

const authFailurePatterns = [
  "Authentication failed",
  "Failed to authenticate",
  "Authorization failed",
  "Authentication timed out",
  "Authentication cancelled"
]

const detectAuthResult = (output: string): GeminiAuthResult => {
  const normalized = stripAnsi(output).toLowerCase()

  // Markers that indicate we are in the middle of or after an auth flow
  const authInitiated = [
    "please visit the following url",
    "enter the authorization code",
    "authorized the application"
  ].some((m) => normalized.includes(m))

  const isSuccess = authSuccessPatterns.some(
    (pattern) =>
      normalized.includes(pattern.toLowerCase()) &&
      (authInitiated || normalized.includes("logged in with google"))
  )

  if (isSuccess) return "success"

  const isFailure = authFailurePatterns.some((pattern) => normalized.includes(pattern.toLowerCase()))

  if (isFailure) return "failure"

  return "pending"
}

// Fixed port for Gemini CLI OAuth callback server
// WHY: Using a fixed port allows Docker port forwarding to work
// SOURCE: https://github.com/google-gemini/gemini-cli/issues/2040
const defaultGeminiOauthCallbackPort = 38_751

type DockerGeminiAuthSpec = {
  readonly cwd: string
  readonly image: string
  readonly hostPath: string
  readonly containerPath: string
  readonly env: ReadonlyArray<string>
  readonly callbackPort: number
}

const buildDockerGeminiAuthSpec = (
  cwd: string,
  accountPath: string,
  image: string,
  containerPath: string,
  port: number
): DockerGeminiAuthSpec => ({
  cwd,
  image,
  hostPath: accountPath,
  containerPath,
  callbackPort: port,
  env: [
    `HOME=${containerPath}`,
    "NO_BROWSER=true",
    "GEMINI_CLI_NONINTERACTIVE=true",
    "GEMINI_CLI_TRUST_ALL=true",
    "GEMINI_DISABLE_UPDATE_CHECK=true",
    `OAUTH_CALLBACK_PORT=${port}`,
    "OAUTH_CALLBACK_HOST=0.0.0.0"
  ]
})
export const buildDockerGeminiAuthArgs = (spec: DockerGeminiAuthSpec): ReadonlyArray<string> => {
  const base: Array<string> = [
    "run",
    "--rm",
    "--init",
    "-i",
    "-t",
    "-v",
    `${spec.hostPath}:${spec.containerPath}`,
    "-p",
    `${spec.callbackPort}:${spec.callbackPort}`,
    "-w",
    spec.containerPath
  ]
  // ...

  // NOTE: Running as root inside the auth container to ensure access to all internal paths.
  // The mounted volume will still be accessible, and credentials will be written there.
  for (const entry of spec.env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
  // Run gemini mcp list with --debug flag to ensure auth URL is shown
  // WHY: In some Gemini CLI versions, auth URL is only shown with --debug flag, and 'login' is no longer a command
  return [...base, spec.image, "gemini", "mcp", "list", "--debug"]
}

const cleanupExistingContainers = (
  port: number
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const out = yield* _(
      runCommandCapture(
        {
          cwd: process.cwd(),
          command: "docker",
          args: ["ps", "-q", "--filter", `publish=${port}`]
        },
        [0],
        () => new Error("docker ps failed")
      ).pipe(
        Effect.map((value) => value.trim()),
        Effect.orElseSucceed(() => "")
      )
    )

    const ids = out.split("\n").filter(Boolean)
    if (ids.length > 0) {
      yield* _(Effect.logInfo(`Cleaning up existing containers using port ${port}: ${ids.join(", ")}`))
      yield* _(
        runCommandExitCode({
          cwd: process.cwd(),
          command: "docker",
          args: ["rm", "-f", ...ids]
        }).pipe(Effect.orElse(() => Effect.succeed(0)))
      )
    }
  })

const startDockerProcess = (
  executor: CommandExecutor.CommandExecutor,
  spec: DockerGeminiAuthSpec
): Effect.Effect<CommandExecutor.Process, PlatformError, Scope.Scope> =>
  executor.start(
    pipe(
      Command.make("docker", ...buildDockerGeminiAuthArgs(spec)),
      Command.workingDirectory(spec.cwd),
      Command.stdin("inherit"),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
  )

const pumpDockerOutput = (
  source: Stream.Stream<Uint8Array, PlatformError>,
  fd: number,
  resultBox: { value: GeminiAuthResult },
  authDeferred: Deferred.Deferred<undefined>
): Effect.Effect<void, PlatformError> => {
  const decoder = new TextDecoder("utf-8")
  let outputWindow = ""

  return pipe(
    source,
    Stream.runForEach((chunk) =>
      Effect.gen(function*(_) {
        yield* _(Effect.sync(() => {
          writeChunkToFd(fd, chunk)
        }))
        outputWindow += decoder.decode(chunk)
        if (outputWindow.length > outputWindowSize) {
          outputWindow = outputWindow.slice(-outputWindowSize)
        }
        if (resultBox.value !== "pending") {
          return
        }
        const result = detectAuthResult(outputWindow)
        if (result !== "pending") {
          resultBox.value = result
          if (result === "success") {
            yield* _(Deferred.succeed(authDeferred, void 0))
          }
        }
      })
    )
  ).pipe(Effect.asVoid)
}

const resolveGeminiLoginResult = (
  result: GeminiAuthResult,
  exitCode: number
): Effect.Effect<void, AuthError | CommandFailedError> =>
  Effect.gen(function*(_) {
    if (result === "success") {
      if (exitCode !== 0) {
        yield* _(
          Effect.logWarning(
            `Gemini CLI returned exit=${exitCode}, but authentication appears successful; continuing.`
          )
        )
      }
      return
    }

    if (result === "failure") {
      yield* _(
        Effect.fail(
          new AuthError({
            message: "Gemini CLI OAuth authentication failed. Please try again."
          })
        )
      )
    }

    if (exitCode !== 0) {
      yield* _(Effect.fail(new CommandFailedError({ command: "gemini", exitCode })))
    }

    // If we get here with pending result and exit code 0, assume success
    // (user may have completed auth flow successfully)
  })

// CHANGE: print OAuth instructions before starting the flow
// WHY: help users understand how to complete OAuth in Docker environment
// QUOTE(ТЗ): "Мне надо что бы он её умел принимать, типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment from skulidropek
// SOURCE: https://github.com/google-gemini/gemini-cli
// PURITY: SHELL
// COMPLEXITY: O(1)
const printOauthInstructions = (): Effect.Effect<void> =>
  Effect.sync(() => {
    const port = defaultGeminiOauthCallbackPort
    process.stderr.write("\n")
    process.stderr.write("╔═══════════════════════════════════════════════════════════════════════════╗\n")
    process.stderr.write("║                    Gemini CLI OAuth Authentication                        ║\n")
    process.stderr.write("╠═══════════════════════════════════════════════════════════════════════════╣\n")
    process.stderr.write("║ 1. Copy the auth URL shown below and open it in your browser              ║\n")
    process.stderr.write("║ 2. Sign in with your Google account                                       ║\n")
    process.stderr.write(`║ 3. After authentication, the browser will redirect to localhost:${port}    ║\n`)
    process.stderr.write("║ 4. The callback will be captured automatically (port is forwarded)        ║\n")
    process.stderr.write("╚═══════════════════════════════════════════════════════════════════════════╝\n")
    process.stderr.write("\n")
  })

// CHANGE: run Gemini CLI OAuth login with interactive prompt and port forwarding
// WHY: Gemini CLI OAuth callback now works in Docker via fixed port forwarding
const fixGeminiAuthPermissions = (hostPath: string, containerPath: string) =>
  runCommandExitCode({
    cwd: process.cwd(),
    command: "docker",
    args: [
      "run",
      "--rm",
      "-v",
      `${hostPath}:${containerPath}`,
      "alpine",
      "chmod",
      "-R",
      "777",
      containerPath
    ]
  }).pipe(
    Effect.tapError((err) => Effect.logWarning(`Failed to fix Gemini auth permissions: ${String(err)}`)),
    Effect.orElse(() => Effect.succeed(0))
  )

// QUOTE(ТЗ): "Типо ждал пока мы вставим ссылку"
// REF: issue-146, PR-147 comment
// SOURCE: https://github.com/google-gemini/gemini-cli
// FORMAT THEOREM: forall (cwd, accountPath): runGeminiOauthLogin(cwd, accountPath) -> auth_completed | error
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: OAuth credentials are stored by Gemini CLI in ~/.gemini within containerPath
// COMPLEXITY: O(user_interaction)
export const runGeminiOauthLoginWithPrompt = (
  cwd: string,
  accountPath: string,
  options: {
    readonly image: string
    readonly containerPath: string
  }
): Effect.Effect<void, AuthError | CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const port = defaultGeminiOauthCallbackPort

      yield* _(cleanupExistingContainers(port))
      yield* _(printOauthInstructions())

      const executor = yield* _(CommandExecutor.CommandExecutor)
      const hostPath = yield* _(resolveDockerVolumeHostPath(cwd, accountPath))
      const spec = buildDockerGeminiAuthSpec(cwd, hostPath, options.image, options.containerPath, port)
      const proc = yield* _(startDockerProcess(executor, spec))

      const authDeferred = yield* _(Deferred.make<undefined>())
      const resultBox: { value: GeminiAuthResult } = { value: "pending" }
      const stdoutFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stdout, 1, resultBox, authDeferred)))
      const stderrFiber = yield* _(Effect.forkScoped(pumpDockerOutput(proc.stderr, 2, resultBox, authDeferred)))

      const exitCode = yield* _(
        Effect.race(
          proc.exitCode.pipe(Effect.map(Number)),
          pipe(
            Deferred.await(authDeferred),
            Effect.delay("500 millis"),
            Effect.flatMap(() => proc.kill()),
            Effect.map(() => 0)
          )
        )
      )

      yield* _(Fiber.interrupt(stdoutFiber))
      yield* _(Fiber.interrupt(stderrFiber))

      // Fix permissions for all files created by root in the volume
      yield* _(fixGeminiAuthPermissions(hostPath, spec.containerPath))

      return yield* _(resolveGeminiLoginResult(resultBox.value, exitCode))
    })
  )
