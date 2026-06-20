import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { buildBrowserFrontendLaunch } from "./browser-frontend-launch.js"
import {
  type BrowserFrontendReuseInput,
  type BrowserFrontendStartDecision,
  type BrowserFrontendStateFile,
  computeLocalBrowserFrontendRevision,
  describeBrowserFrontendRestartReason,
  readBrowserFrontendState,
  resolveBrowserFrontendStatePath,
  shouldReuseBrowserFrontend
} from "./browser-frontend-state.js"
import { findReachableApiBaseUrl } from "./controller-health.js"
import {
  resolveConfiguredApiBaseUrl,
  resolveDefaultLocalApiBaseUrl,
  resolveExplicitApiBaseUrl,
  uniqueStrings
} from "./controller-reachability.js"
import { type ControllerRuntime, ensureControllerReady, resolveApiBaseUrl } from "./controller.js"
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

// CHANGE: expose `docker-git browser` on all host interfaces by default
// WHY: LAN clients cannot connect when the web shell is bound to loopback only
// QUOTE(ТЗ): "Я хочу подключить"
// REF: user-request-2026-04-21-browser-lan-bind
// SOURCE: n/a
// FORMAT THEOREM: default(bindHost) = 0.0.0.0 -> forall h in HostIPv4Interfaces: listens(h, webPort), firewall permitting
// PURITY: SHELL
// EFFECT: reads process.env only at CLI boundary
// INVARIANT: explicit DOCKER_GIT_WEB_HOST takes precedence over the LAN-friendly default
// COMPLEXITY: O(1)/O(1)
const defaultWebHost = "0.0.0.0"

const webHost = (): string => process.env["DOCKER_GIT_WEB_HOST"]?.trim() || defaultWebHost

const webPort = (): string => process.env["DOCKER_GIT_WEB_PORT"]?.trim() || "4174"

type BrowserFrontendRuntimeState = {
  readonly webPids: ReadonlyArray<string>
  readonly webState: BrowserFrontendStateFile | null
}

export interface BrowserFrontendCommandOptions {
  readonly daemon: boolean
}

const browserFrontendForegroundOptions: BrowserFrontendCommandOptions = { daemon: false }

type BrowserFrontendRunnerEffect = Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  CommandExecutor.CommandExecutor
>

const runStreaming = (
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCodeStreaming({ args, command: "bun", cwd: process.cwd(), env })

const parsePids = (output: string): ReadonlyArray<string> =>
  output
    .split(/\s+/u)
    .map((pid) => pid.trim())
    .filter((pid) => /^\d+$/u.test(pid))

// CHANGE: derive a stable daemon log path beside the browser runtime state file.
// WHY: detached mode must preserve diagnostics after the parent CLI exits.
// QUOTE(ТЗ): "Run browser with support dameon mode, like a flag -d"
// REF: issue-373
// SOURCE: n/a
// FORMAT THEOREM: suffix(statePath,".json") -> logPath = prefix(statePath,".json") + ".log"
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: every state path maps deterministically to exactly one log path
// COMPLEXITY: O(n)/O(n) where n = |statePath|
const browserFrontendLogPath = (statePath: string): string =>
  statePath.endsWith(".json") ? `${statePath.slice(0, -".json".length)}.log` : `${statePath}.log`

const parseDaemonPid = (output: string): Effect.Effect<string, ControllerBootstrapError> => {
  const pid = parsePids(output)[0]
  return pid === undefined
    ? Effect.fail(browserFrontendError("Browser frontend daemon did not report a pid."))
    : Effect.succeed(pid)
}

const startDaemon = (
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>>,
  logPath: string
): Effect.Effect<string, ControllerBootstrapError | PlatformError, CommandExecutor.CommandExecutor> => {
  const script = [
    "log_path=\"$1\"",
    "shift",
    "command -v nohup >/dev/null 2>&1 || exit 127",
    "command -v \"$1\" >/dev/null 2>&1 || exit 127",
    "mkdir -p \"$(dirname \"$log_path\")\"",
    "nohup \"$@\" >>\"$log_path\" 2>&1 < /dev/null &",
    String.raw`printf '%s\n' "$!"`
  ].join("\n")

  return runCommandCapture(
    { args: ["-c", script, "sh", logPath, "bun", ...args], command: "sh", cwd: process.cwd(), env },
    [0],
    () => browserFrontendError("Failed to start browser frontend daemon.")
  ).pipe(Effect.flatMap((output) => parseDaemonPid(output)))
}

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

const readBrowserFrontendRuntimeState = (
  statePath: string
): Effect.Effect<
  BrowserFrontendRuntimeState,
  never,
  ControllerRuntime
> =>
  Effect.all({
    webPids: findWebServerPids(),
    webState: readBrowserFrontendState(statePath)
  })

// CHANGE: prefer the host-facing controller URL for the browser web proxy.
// WHY: controller bootstrap may select a Docker bridge IP before the published localhost port is reachable, but the served browser runtime must keep durable state and proxy config on the externally reachable endpoint.
// QUOTE(ТЗ): "комментарии ребита надо было тоже поддержать"
// REF: PR #344 E2E (Browser command) regression.
// SOURCE: n/a
// FORMAT THEOREM: strict_explicit_api -> strict_explicit_api; reachable(local_api) -> local_api; otherwise -> selected_api
// PURITY: SHELL
// EFFECT: Effect<string, never, ControllerRuntime>
// INVARIANT: strict explicit DOCKER_GIT_API_URL is never overridden by auto-discovery.
// COMPLEXITY: O(1) probes/O(1) space.
/**
 * Resolves the API URL used by the browser frontend proxy.
 *
 * @returns Effect with the strict explicit API URL, a reachable local host URL, or the selected controller URL.
 *
 * @pure false
 * @effect FetchHttpClient through controller health probing.
 * @invariant Strict explicit `DOCKER_GIT_API_URL` has precedence over all inferred endpoints.
 * @precondition `ensureControllerReady` has already completed for inferred endpoints.
 * @postcondition A configured host URL is used only after a successful health probe.
 * @complexity O(1) time and O(1) space for the bounded candidate set.
 * @throws Never - health probe failures fall back to the selected controller URL.
 */
const resolveBrowserFrontendApiBaseUrl = (): Effect.Effect<string, never, ControllerRuntime> => {
  const selectedApiBaseUrl = resolveApiBaseUrl()
  const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
  if (explicitApiBaseUrl !== undefined) {
    return Effect.succeed(explicitApiBaseUrl)
  }

  const configuredApiBaseUrl = resolveConfiguredApiBaseUrl()
  const candidateApiBaseUrls = uniqueStrings([
    resolveDefaultLocalApiBaseUrl() ?? "",
    configuredApiBaseUrl
  ].filter((value) => value.length > 0))
  if (candidateApiBaseUrls.includes(selectedApiBaseUrl)) {
    return Effect.succeed(selectedApiBaseUrl)
  }

  return findReachableApiBaseUrl(candidateApiBaseUrls).pipe(
    Effect.match({
      onFailure: () => selectedApiBaseUrl,
      onSuccess: (apiBaseUrl) => apiBaseUrl
    })
  )
}

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
  BrowserFrontendStartDecision,
  ControllerBootstrapError | PlatformError,
  ControllerRuntime
> =>
  Effect.gen(function*(_) {
    const host = webHost()
    const port = webPort()
    const statePath = yield* _(resolveBrowserFrontendStatePath())
    const webRevision = yield* _(computeLocalBrowserFrontendRevision())

    yield* _(Effect.log("Ensuring docker-git API controller is current."))
    yield* _(ensureControllerReady())

    const apiBaseUrl = yield* _(resolveBrowserFrontendApiBaseUrl())
    const runtimeState = yield* _(readBrowserFrontendRuntimeState(statePath))
    const reuseInput: BrowserFrontendReuseInput = {
      apiBaseUrl,
      host,
      port,
      revision: webRevision,
      state: runtimeState.webState,
      webPids: runtimeState.webPids
    }
    const shouldStartWeb = !shouldReuseBrowserFrontend(reuseInput)

    if (!shouldStartWeb) {
      yield* _(Effect.log(`docker-git browser frontend unchanged (${webRevision}).`))
      return {
        shouldStartWeb,
        apiBaseUrl,
        host,
        port,
        statePath,
        webRevision
      }
    }

    yield* _(Effect.log(`Starting docker-git browser frontend: ${describeBrowserFrontendRestartReason(reuseInput)}.`))
    yield* _(stopCurrentWebServer())
    return {
      shouldStartWeb,
      apiBaseUrl,
      host,
      port,
      statePath,
      webRevision
    }
  })

const ensureSuccess = (
  exitCode: number,
  action: string
): Effect.Effect<void, ControllerBootstrapError> =>
  exitCode === 0
    ? Effect.void
    : Effect.fail(browserFrontendError(`${action} failed with exit code ${exitCode}.`))

export const runBrowserFrontend = (decision: BrowserFrontendStartDecision): BrowserFrontendRunnerEffect =>
  Effect.gen(function*(_) {
    const launch = yield* _(buildBrowserFrontendLaunch(decision))
    yield* _(Effect.log(`docker-git browser frontend: ${launch.localUrl}`))
    yield* _(Effect.log("Press Ctrl+C to stop the browser frontend."))
    const serveExitCode = yield* _(runStreaming(["run", "--cwd", "packages/app", "serve:web"], launch.env))
    yield* _(ensureSuccess(serveExitCode, "Browser frontend server"))
  })

export const runBrowserFrontendDaemon = (decision: BrowserFrontendStartDecision): BrowserFrontendRunnerEffect =>
  Effect.gen(function*(_) {
    const launch = yield* _(buildBrowserFrontendLaunch(decision))
    const logPath = browserFrontendLogPath(decision.statePath)

    const pid = yield* _(startDaemon(["run", "--cwd", "packages/app", "serve:web"], launch.env, logPath))
    yield* _(Effect.log(`docker-git browser frontend daemon: ${launch.localUrl} (pid ${pid})`))
    yield* _(Effect.log(`docker-git browser frontend daemon log: ${logPath}`))
  })

// CHANGE: make `docker-git browser` idempotent for local development
// WHY: repeated invocations should deploy only changed API or browser code
// QUOTE(ТЗ): "Надо перезапускать только те контейнеры у которых изменился код"
// REF: user-message-2026-04-21-browser-selective-restart
// SOURCE: n/a
// FORMAT THEOREM: forall run: unchanged(web_revision, state, pid) -> not restarted(web)
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError | PlatformError, ControllerRuntime>
// INVARIANT: controller readiness is checked independently from browser runtime reuse
// COMPLEXITY: O(total_bytes(web_inputs) + processes + controller_probe)
export const runBrowserFrontendCommandWithOptions = (
  options: BrowserFrontendCommandOptions
): Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  ControllerRuntime
> =>
  pipe(
    prepareBrowserStack(),
    Effect.flatMap((decision) => {
      if (!decision.shouldStartWeb) {
        return Effect.log(`docker-git browser frontend is already running at http://${decision.host}:${decision.port}/`)
      }
      return (options.daemon ? runBrowserFrontendDaemon : runBrowserFrontend)(decision)
    })
  )

export const runBrowserFrontendCommand: Effect.Effect<
  void,
  ControllerBootstrapError | PlatformError,
  ControllerRuntime
> = runBrowserFrontendCommandWithOptions(browserFrontendForegroundOptions)
