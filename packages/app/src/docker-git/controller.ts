import { FetchHttpClient, HttpClient } from "@effect/platform"
import { Duration, Effect, pipe, Schedule } from "effect"

import {
  controllerContainerName,
  type ControllerRuntime,
  ensureControllerReachabilityNetworks,
  inspectContainerNetworks,
  inspectControllerPublishedPorts,
  resolveCurrentContainerNetworks,
  runCompose
} from "./controller-docker.js"
import {
  buildApiBaseUrlCandidates,
  type DockerNetworkIps,
  formatNetworkIps,
  isRemoteDockerHost,
  resolveApiPort,
  resolveConfiguredApiBaseUrl,
  resolveExplicitApiBaseUrl,
  trimTrailingSlashes
} from "./controller-reachability.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export type { ControllerRuntime } from "./controller-docker.js"
export { buildApiBaseUrlCandidates, isRemoteDockerHost } from "./controller-reachability.js"

let selectedApiBaseUrl: string | undefined

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

const rememberSelectedApiBaseUrl = (value: string): void => {
  selectedApiBaseUrl = trimTrailingSlashes(value)
}

export const resolveApiBaseUrl = (): string =>
  resolveExplicitApiBaseUrl() ?? selectedApiBaseUrl ?? resolveConfiguredApiBaseUrl()

const probeHealth = (apiBaseUrl: string): Effect.Effect<void, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(client.get(`${apiBaseUrl}/health`, { headers: { accept: "application/json" } }))

    if (response.status >= 200 && response.status < 300) {
      return
    }

    return yield* _(
      Effect.fail(
        controllerBootstrapError(
          `docker-git controller health returned ${response.status} at ${apiBaseUrl}/health`
        )
      )
    )
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error): ControllerBootstrapError =>
      error._tag === "ControllerBootstrapError"
        ? error
        : {
          _tag: "ControllerBootstrapError",
          message: `docker-git controller health probe failed at ${apiBaseUrl}/health\nDetails: ${String(error)}`
        }
    )
  )

const findReachableApiBaseUrl = (
  candidateUrls: ReadonlyArray<string>
): Effect.Effect<string, ControllerBootstrapError> =>
  Effect.gen(function*(_) {
    if (candidateUrls.length === 0) {
      return yield* _(
        Effect.fail(controllerBootstrapError("No docker-git controller endpoint candidates were generated."))
      )
    }

    for (const candidateUrl of candidateUrls) {
      const healthy = yield* _(
        probeHealth(candidateUrl).pipe(
          Effect.match({
            onFailure: () => false,
            onSuccess: () => true
          })
        )
      )

      if (healthy) {
        return candidateUrl
      }
    }

    return yield* _(Effect.fail(controllerBootstrapError("No docker-git controller endpoint responded to /health.")))
  })

const collectReachabilityDiagnostics = (
  candidateUrls: ReadonlyArray<string>,
  currentContainerNetworks: DockerNetworkIps,
  controllerNetworks: DockerNetworkIps
): Effect.Effect<string, never, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const publishedPorts = yield* _(inspectControllerPublishedPorts())

    return [
      "Tried endpoints:",
      ...candidateUrls.map((candidateUrl) => `- ${candidateUrl}`),
      `Published ports: ${publishedPorts.length > 0 ? publishedPorts : "unavailable"}`,
      `Current runtime networks: ${formatNetworkIps(currentContainerNetworks)}`,
      `Controller networks: ${formatNetworkIps(controllerNetworks)}`
    ].join("\n")
  })

const waitForReachableApiBaseUrl = (
  candidateUrls: ReadonlyArray<string>,
  currentContainerNetworks: DockerNetworkIps,
  controllerNetworks: DockerNetworkIps
): Effect.Effect<string, ControllerBootstrapError, ControllerRuntime> =>
  pipe(
    findReachableApiBaseUrl(candidateUrls),
    Effect.retry(
      Schedule.addDelay(Schedule.recurs(30), () => Duration.seconds(2))
    ),
    Effect.catchAll((error) =>
      Effect.gen(function*(_) {
        const diagnostics = yield* _(
          collectReachabilityDiagnostics(candidateUrls, currentContainerNetworks, controllerNetworks)
        )
        return yield* _(
          Effect.fail(
            controllerBootstrapError(
              [
                "docker-git controller did not become reachable.",
                error.message,
                diagnostics
              ].join("\n")
            )
          )
        )
      })
    )
  )

const failIfRemoteDockerWithoutApiUrl = (): Effect.Effect<void, ControllerBootstrapError> => {
  const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
  if (!isRemoteDockerHost() || explicitApiBaseUrl !== undefined) {
    return Effect.void
  }

  const dockerHost = process.env["DOCKER_HOST"]?.trim() ?? ""
  return Effect.fail(
    controllerBootstrapError(
      [
        "docker-git host CLI cannot auto-discover the controller over a remote DOCKER_HOST.",
        `DOCKER_HOST: ${dockerHost.length > 0 ? dockerHost : "unknown"}`,
        "Set DOCKER_GIT_API_URL to a reachable controller URL."
      ].join("\n")
    )
  )
}

// CHANGE: bootstrap the API controller before issuing host-side API requests
// WHY: host CLI must not fall back to local state; controller owns .docker-git and project runtime
// QUOTE(ТЗ): "app(cli) инструмент общается только с API а API имеет свой .docker-git"
// REF: user-request-2026-04-01-api-only-host
// SOURCE: n/a
// FORMAT THEOREM: ∀cmd: controller(cmd) starts before api(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, ControllerBootstrapError, CommandExecutor>
// INVARIANT: controller is reachable from the current runtime before any host API dispatch
// COMPLEXITY: O(1) compose + O(k) health checks
export const ensureControllerReady = (): Effect.Effect<void, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    yield* _(failIfRemoteDockerWithoutApiUrl())

    const currentContainerNetworks = yield* _(resolveCurrentContainerNetworks())
    const initialControllerNetworks = yield* _(inspectContainerNetworks(controllerContainerName))
    const initialCandidates = buildApiBaseUrlCandidates({
      explicitApiBaseUrl: resolveExplicitApiBaseUrl(),
      cachedApiBaseUrl: selectedApiBaseUrl,
      defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
      currentContainerNetworks,
      controllerNetworks: initialControllerNetworks,
      port: resolveApiPort()
    })

    const reachableBeforeStart = yield* _(
      findReachableApiBaseUrl(initialCandidates).pipe(
        Effect.match({
          onFailure: () => {},
          onSuccess: (apiBaseUrl) => apiBaseUrl
        })
      )
    )

    if (reachableBeforeStart !== undefined) {
      rememberSelectedApiBaseUrl(reachableBeforeStart)
      return
    }

    yield* _(runCompose(["up", "-d", "--build"]))
    yield* _(ensureControllerReachabilityNetworks(currentContainerNetworks))

    const controllerNetworks = yield* _(inspectContainerNetworks(controllerContainerName))
    const candidateUrls = buildApiBaseUrlCandidates({
      explicitApiBaseUrl: resolveExplicitApiBaseUrl(),
      cachedApiBaseUrl: selectedApiBaseUrl,
      defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
      currentContainerNetworks,
      controllerNetworks,
      port: resolveApiPort()
    })
    const reachableApiBaseUrl = yield* _(
      waitForReachableApiBaseUrl(candidateUrls, currentContainerNetworks, controllerNetworks)
    )

    rememberSelectedApiBaseUrl(reachableApiBaseUrl)
  })
