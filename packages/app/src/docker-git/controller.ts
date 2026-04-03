import { FetchHttpClient, HttpClient } from "@effect/platform"
import { Duration, Effect, pipe, Schedule } from "effect"

import {
  controllerContainerName,
  controllerExists,
  type ControllerRuntime,
  ensureControllerReachabilityNetworks,
  inspectContainerNetworks,
  inspectControllerPublishedPorts,
  inspectControllerRevision,
  prepareLocalControllerRevision,
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
import { shouldForceRecreateController } from "./controller-revision.js"
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
    Effect.matchEffect({
      onFailure: (error) =>
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
        }),
      onSuccess: (apiBaseUrl) => Effect.succeed(apiBaseUrl)
    })
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

const findReachableApiBaseUrlOption = (
  candidateUrls: ReadonlyArray<string>
): Effect.Effect<string | undefined, ControllerBootstrapError> =>
  findReachableApiBaseUrl(candidateUrls).pipe(
    Effect.match({
      onFailure: (): string | undefined => undefined,
      onSuccess: (apiBaseUrl) => apiBaseUrl
    })
  )

const findReachableDirectApiBaseUrl = (
  explicitApiBaseUrl: string | undefined
): Effect.Effect<string | undefined, ControllerBootstrapError> =>
  findReachableApiBaseUrlOption(
    buildApiBaseUrlCandidates({
      explicitApiBaseUrl,
      cachedApiBaseUrl: selectedApiBaseUrl,
      defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
      currentContainerNetworks: {},
      controllerNetworks: {},
      port: resolveApiPort()
    })
  )

const failIfExplicitApiUrlIsUnreachable = (
  explicitApiBaseUrl: string | undefined
): Effect.Effect<void, ControllerBootstrapError> =>
  explicitApiBaseUrl === undefined
    ? Effect.void
    : Effect.fail(
      controllerBootstrapError(
        [
          `docker-git controller is not reachable at ${explicitApiBaseUrl}.`,
          "Set DOCKER_GIT_API_URL to a reachable backend or unset it to allow local Docker bootstrap."
        ].join("\n")
      )
    )

type ControllerBootstrapContext = {
  readonly explicitApiBaseUrl: string | undefined
  readonly localControllerRevision: string
  readonly currentControllerRevision: string | null
  readonly forceRecreateController: boolean
  readonly currentContainerNetworks: DockerNetworkIps
  readonly initialControllerNetworks: DockerNetworkIps
}

const loadControllerBootstrapContext = (): Effect.Effect<
  ControllerBootstrapContext,
  ControllerBootstrapError,
  ControllerRuntime
> =>
  Effect.gen(function*(_) {
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    const localControllerRevision = yield* _(prepareLocalControllerRevision())
    const currentControllerExists = yield* _(controllerExists())
    const currentControllerRevision = yield* _(inspectControllerRevision())
    const currentContainerNetworks = yield* _(resolveCurrentContainerNetworks())
    const initialControllerNetworks = yield* _(inspectContainerNetworks(controllerContainerName))

    return {
      explicitApiBaseUrl,
      localControllerRevision,
      currentControllerRevision,
      forceRecreateController: shouldForceRecreateController(
        currentControllerExists,
        localControllerRevision,
        currentControllerRevision
      ),
      currentContainerNetworks,
      initialControllerNetworks
    }
  })

const buildBootstrapCandidateUrls = (
  explicitApiBaseUrl: string | undefined,
  currentContainerNetworks: DockerNetworkIps,
  controllerNetworks: DockerNetworkIps
): ReadonlyArray<string> =>
  buildApiBaseUrlCandidates({
    explicitApiBaseUrl,
    cachedApiBaseUrl: selectedApiBaseUrl,
    defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
    currentContainerNetworks,
    controllerNetworks,
    port: resolveApiPort()
  })

const reuseReachableControllerIfPossible = (
  context: ControllerBootstrapContext
): Effect.Effect<boolean, ControllerBootstrapError> =>
  findReachableApiBaseUrlOption(
    buildBootstrapCandidateUrls(
      context.explicitApiBaseUrl,
      context.currentContainerNetworks,
      context.initialControllerNetworks
    )
  ).pipe(
    Effect.map((reachableApiBaseUrl) => {
      if (reachableApiBaseUrl === undefined || context.forceRecreateController) {
        return false
      }
      rememberSelectedApiBaseUrl(reachableApiBaseUrl)
      return true
    })
  )

const logControllerRecreate = (
  localControllerRevision: string,
  currentControllerRevision: string | null
): Effect.Effect<void> =>
  Effect.log(
    `Rebuilding docker-git controller: local revision ${localControllerRevision}, container revision ${
      currentControllerRevision ?? "unknown"
    }`
  )

const startAndRememberController = (
  context: ControllerBootstrapContext
): Effect.Effect<void, ControllerBootstrapError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    if (context.forceRecreateController) {
      yield* _(logControllerRecreate(context.localControllerRevision, context.currentControllerRevision))
    }

    yield* _(
      runCompose(
        context.forceRecreateController ? ["up", "-d", "--build", "--force-recreate"] : ["up", "-d", "--build"]
      )
    )
    yield* _(ensureControllerReachabilityNetworks(context.currentContainerNetworks))

    const controllerNetworks = yield* _(inspectContainerNetworks(controllerContainerName))
    const candidateUrls = buildBootstrapCandidateUrls(
      context.explicitApiBaseUrl,
      context.currentContainerNetworks,
      controllerNetworks
    )
    const reachableApiBaseUrl = yield* _(
      waitForReachableApiBaseUrl(candidateUrls, context.currentContainerNetworks, controllerNetworks)
    )
    rememberSelectedApiBaseUrl(reachableApiBaseUrl)
  })

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
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    const reachableBeforeDocker = yield* _(findReachableDirectApiBaseUrl(explicitApiBaseUrl))

    if (reachableBeforeDocker !== undefined) {
      rememberSelectedApiBaseUrl(reachableBeforeDocker)
      return
    }

    yield* _(failIfExplicitApiUrlIsUnreachable(explicitApiBaseUrl))
    const bootstrapContext = yield* _(loadControllerBootstrapContext())
    const reusedExistingController = yield* _(reuseReachableControllerIfPossible(bootstrapContext))
    if (reusedExistingController) {
      return
    }
    yield* _(startAndRememberController(bootstrapContext))
  })
