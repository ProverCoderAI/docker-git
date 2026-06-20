import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { ensurePrebuiltBrowserFrontend, shouldUsePrebuiltBrowserFrontend } from "./browser-frontend-prebuilt.js"
import type { BrowserFrontendStartDecision } from "./browser-frontend-state.js"
import { runCommandExitCodeStreaming } from "./frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "./host-errors.js"

type BrowserFrontendLaunch = {
  readonly env: Readonly<Record<string, string>>
  readonly localUrl: string
}

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

const browserEnv = (decision: BrowserFrontendStartDecision): Readonly<Record<string, string>> => ({
  ...copyProcessEnv(),
  DOCKER_GIT_API_URL: decision.apiBaseUrl,
  DOCKER_GIT_WEB_HOST: decision.host,
  DOCKER_GIT_WEB_PORT: decision.port,
  DOCKER_GIT_WEB_REVISION: decision.webRevision,
  DOCKER_GIT_WEB_STATE_PATH: decision.statePath
})

const ensureSuccess = (
  exitCode: number,
  action: string
): Effect.Effect<void, ControllerBootstrapError> =>
  exitCode === 0
    ? Effect.void
    : Effect.fail(browserFrontendError(`${action} failed with exit code ${exitCode}.`))

const runStreaming = (
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCodeStreaming({ args, command: "bun", cwd: process.cwd(), env })

// CHANGE: share the browser frontend build phase between foreground and daemon modes.
// WHY: daemon mode must not drift from foreground mode in revision, environment, or build failure semantics.
// QUOTE(ТЗ): "Run browser with support dameon mode, like a flag -d"
// REF: issue-373
// SOURCE: n/a
// FORMAT THEOREM: forall mode in {foreground,daemon}: launch(mode) -> built_or_prebuilt(webRevision)
// PURITY: SHELL
// EFFECT: Effect<BrowserFrontendLaunch, ControllerBootstrapError | PlatformError, CommandExecutor>
// INVARIANT: launch env is derived exactly once from BrowserFrontendStartDecision
// COMPLEXITY: O(build)/O(env)
export const buildBrowserFrontendLaunch = (
  decision: BrowserFrontendStartDecision
): Effect.Effect<BrowserFrontendLaunch, ControllerBootstrapError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const env = browserEnv(decision)
    const localUrl = `http://${decision.host}:${decision.port}/`

    if (shouldUsePrebuiltBrowserFrontend()) {
      yield* _(
        Effect.log(`Using prebuilt docker-git browser frontend ${decision.webRevision} for API ${decision.apiBaseUrl}.`)
      )
      yield* _(ensurePrebuiltBrowserFrontend())
      return { env, localUrl }
    }

    yield* _(Effect.log(`Building docker-git browser frontend ${decision.webRevision} for API ${decision.apiBaseUrl}.`))
    const buildExitCode = yield* _(runStreaming(["run", "--cwd", "packages/app", "build:web"], env))
    yield* _(ensureSuccess(buildExitCode, "Browser frontend build"))
    return { env, localUrl }
  })
