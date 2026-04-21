import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { controllerExists } from "./controller-docker.js"
import { type ControllerRuntime, ensureControllerReady, resolveApiBaseUrl, restartController } from "./controller.js"
import {
  runCommandCapture,
  runCommandExitCode,
  runCommandExitCodeStreaming
} from "./frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "./host-errors.js"

const browserFrontendError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const copyProcessEnv = (): Readonly<Record<string, string>> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

const webHost = (): string => process.env["DOCKER_GIT_WEB_HOST"]?.trim() || "127.0.0.1"

const webPort = (): string => process.env["DOCKER_GIT_WEB_PORT"]?.trim() || "4174"

type BrowserFrontendRuntimeState = {
  readonly controllerRunning: boolean
  readonly webPids: ReadonlyArray<string>
}

const browserEnv = (apiBaseUrl: string): Readonly<Record<string, string>> => ({
  ...copyProcessEnv(),
  DOCKER_GIT_API_URL: apiBaseUrl,
  DOCKER_GIT_WEB_HOST: webHost(),
  DOCKER_GIT_WEB_PORT: webPort()
})

const runStreaming = (
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCodeStreaming({
    args,
    command: "bun",
    cwd: process.cwd(),
    env
  })

const parsePids = (output: string): ReadonlyArray<string> =>
  output
    .split(/\s+/u)
    .map((pid) => pid.trim())
    .filter((pid) => /^\d+$/u.test(pid))

const findWebServerPids = (): Effect.Effect<ReadonlyArray<string>, never, CommandExecutor.CommandExecutor> => {
  const script = [
    "port=\"$1\"",
    "if command -v lsof >/dev/null 2>&1; then",
    "  lsof -nP -tiTCP:\"$port\" -sTCP:LISTEN 2>/dev/null || true",
    "  exit 0",
    "fi",
    "if command -v fuser >/dev/null 2>&1; then",
    String.raw`  fuser "$port/tcp" 2>/dev/null | tr ' ' '\n' || true`,
    "fi"
  ].join("\n")

  return runCommandCapture(
    {
      cwd: process.cwd(),
      command: "sh",
      args: ["-c", script, "sh", webPort()]
    },
    [0],
    () => browserFrontendError("Failed to inspect docker-git browser frontend port.")
  ).pipe(
    Effect.map((output) => parsePids(output)),
    Effect.orElseSucceed((): ReadonlyArray<string> => [])
  )
}

const stopWebServerPids = (
  pids: ReadonlyArray<string>
): Effect.Effect<void, ControllerBootstrapError | PlatformError, CommandExecutor.CommandExecutor> => {
  if (pids.length === 0) {
    return Effect.void
  }

  const script = [
    "kill \"$@\" 2>/dev/null || true",
    "sleep 1",
    "kill -9 \"$@\" 2>/dev/null || true"
  ].join("\n")

  return runCommandExitCode({
    cwd: process.cwd(),
    command: "sh",
    args: ["-c", script, "sh", ...pids]
  }).pipe(
    Effect.flatMap((exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(browserFrontendError(`Failed to stop browser frontend pids: ${pids.join(", ")}`))
    )
  )
}

const readBrowserFrontendRuntimeState = (): Effect.Effect<
  BrowserFrontendRuntimeState,
  never,
  ControllerRuntime
> =>
  Effect.all({
    controllerRunning: controllerExists().pipe(Effect.orElseSucceed(() => false)),
    webPids: findWebServerPids()
  })

const renderRunningSummary = (state: BrowserFrontendRuntimeState): string =>
  [
    state.controllerRunning ? "API controller is already running" : "",
    state.webPids.length > 0 ? `browser frontend is listening on port ${webPort()}` : ""
  ].filter((line) => line.length > 0).join("; ")

const hasRunningBrowserStack = (state: BrowserFrontendRuntimeState): boolean =>
  state.controllerRunning || state.webPids.length > 0

const normalizePromptAnswer = (answer: string): boolean => {
  const normalized = answer.trim().toLowerCase()
  return normalized.length === 0 || normalized === "y" || normalized === "yes" || normalized === "д" ||
    normalized === "да"
}

const promptRestart = (state: BrowserFrontendRuntimeState): Effect.Effect<boolean> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Effect.succeed(true)
  }

  return Effect.async((resume) => {
    const onData = (chunk: Buffer) => {
      process.stdin.off("data", onData)
      resume(Effect.succeed(normalizePromptAnswer(chunk.toString("utf8"))))
    }

    process.stdout.write(`${renderRunningSummary(state)}. Restart API and web frontend? [Y/n] `)
    process.stdin.resume()
    process.stdin.once("data", onData)

    return Effect.sync(() => {
      process.stdin.off("data", onData)
    })
  })
}

const shouldRestartBrowserStack = (
  state: BrowserFrontendRuntimeState
): Effect.Effect<boolean> => hasRunningBrowserStack(state) ? promptRestart(state) : Effect.succeed(false)

const stopCurrentWebServer = (): Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  CommandExecutor.CommandExecutor
> =>
  pipe(
    findWebServerPids(),
    Effect.tap((pids) =>
      pids.length === 0 ? Effect.void : Effect.log(`Stopping existing browser frontend pids: ${pids.join(", ")}`)
    ),
    Effect.flatMap((pids) => stopWebServerPids(pids))
  )

const prepareBrowserStack = (): Effect.Effect<
  boolean,
  ControllerBootstrapError | PlatformError,
  ControllerRuntime
> =>
  Effect.gen(function*(_) {
    const runtimeState = yield* _(readBrowserFrontendRuntimeState())
    const restart = yield* _(shouldRestartBrowserStack(runtimeState))
    if (!restart) {
      yield* _(ensureControllerReady())
      return runtimeState.webPids.length === 0
    }

    yield* _(Effect.log("Restarting docker-git API controller."))
    yield* _(restartController())
    yield* _(stopCurrentWebServer())
    return true
  })

const ensureSuccess = (
  exitCode: number,
  action: string
): Effect.Effect<void, ControllerBootstrapError> =>
  exitCode === 0
    ? Effect.void
    : Effect.fail(browserFrontendError(`${action} failed with exit code ${exitCode}.`))

export const runBrowserFrontend: Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  CommandExecutor.CommandExecutor
> = Effect.gen(function*(_) {
  const apiBaseUrl = resolveApiBaseUrl()
  const host = webHost()
  const port = webPort()
  const env = browserEnv(apiBaseUrl)
  const localUrl = `http://${host}:${port}/`

  yield* _(Effect.log(`Building docker-git browser frontend for API ${apiBaseUrl}.`))
  const buildExitCode = yield* _(runStreaming(["run", "--cwd", "packages/app", "build:web"], env))
  yield* _(ensureSuccess(buildExitCode, "Browser frontend build"))

  yield* _(Effect.log(`docker-git browser frontend: ${localUrl}`))
  yield* _(Effect.log("Press Ctrl+C to stop the browser frontend."))
  const serveExitCode = yield* _(runStreaming(["run", "--cwd", "packages/app", "serve:web"], env))
  yield* _(ensureSuccess(serveExitCode, "Browser frontend server"))
})

// CHANGE: make `docker-git browser` idempotent for local development
// WHY: repeated invocations should deploy current controller code and replace the previous web process
// QUOTE(ТЗ): "если её вызвать заново то перезапустит и web и api"
// REF: user-request-2026-04-21-browser-restart
// SOURCE: n/a
// FORMAT THEOREM: ∀run: existing(api ∨ web) ∧ confirm(run) → restarted(api) ∧ restarted(web)
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError | PlatformError, CommandExecutor>
// INVARIANT: a confirmed rerun force-recreates the controller before serving the new frontend
// COMPLEXITY: O(processes + compose)
export const runBrowserFrontendCommand: Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  ControllerRuntime
> = pipe(
  prepareBrowserStack(),
  Effect.flatMap((shouldStartWeb) =>
    shouldStartWeb
      ? runBrowserFrontend
      : Effect.log(`docker-git browser frontend is already running at http://${webHost()}:${webPort()}/`)
  )
)
