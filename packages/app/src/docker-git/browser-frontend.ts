import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { resolveApiBaseUrl } from "./controller.js"
import { runCommandExitCodeStreaming } from "./frontend-lib/shell/command-runner.js"
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
