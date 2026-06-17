import { Duration, Effect, pipe, Schedule } from "effect"

import { resolveControllerComposeUpArgs, shouldBuildControllerImage } from "./controller-bootstrap-plan.js"
import * as ControllerDocker from "./controller-docker.js"
import { findReachableApiBaseUrl, findReachableDirectHealthProbe } from "./controller-health.js"
import { inspectControllerImageRevision } from "./controller-image-revision.js"
import { collectReachabilityDiagnostics } from "./controller-reachability-diagnostics.js"
import {
  buildApiBaseUrlCandidates,
  type DockerNetworkIps,
  resolveApiPort,
  resolveConfiguredApiBaseUrl,
  resolveDefaultLocalApiBaseUrl,
  resolveExplicitApiBaseUrl,
  shouldRequireExplicitApiUrlForRemoteDocker,
  trimTrailingSlashes
} from "./controller-reachability.js"
import {
  prepareControllerResourceLimitEnv,
  shouldForceRecreateForControllerResourceLimits
} from "./controller-resource-limits-shell.js"
import { shouldForceRecreateController } from "./controller-revision.js"
import { prepareControllerRuntimeEnv } from "./controller-runtime-shell.js"
import type { ControllerBootstrapError } from "./host-errors.js"

export type { ControllerRuntime } from "./controller-docker.js"
export { buildApiBaseUrlCandidates, isRemoteDockerHost } from "./controller-reachability.js"

let selectedApiBaseUrl: string | undefined

const controllerBootstrapError = (message: string): ControllerBootstrapError => ({
  _tag: "ControllerBootstrapError",
  message
})

type ControllerEffect<A> = Effect.Effect<A, ControllerBootstrapError, ControllerDocker.ControllerRuntime>

const rememberSelectedApiBaseUrl = (value: string): void => {
  selectedApiBaseUrl = trimTrailingSlashes(value)
}

export const resolveApiBaseUrl = (): string =>
  resolveExplicitApiBaseUrl() ?? selectedApiBaseUrl ?? resolveConfiguredApiBaseUrl()

const waitForReachableApiBaseUrl = (
  candidateUrls: ReadonlyArray<string>,
  currentContainerNetworks: DockerNetworkIps,
  controllerNetworks: DockerNetworkIps,
  expectedRevision: string | undefined
): ControllerEffect<string> =>
  pipe(
    findReachableApiBaseUrl(candidateUrls, expectedRevision),
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

const failIfRemoteDockerWithoutApiUrl = (
  currentContainerNetworks: DockerNetworkIps
): Effect.Effect<void, ControllerBootstrapError> => {
  const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
  if (
    !shouldRequireExplicitApiUrlForRemoteDocker(
      process.env["DOCKER_HOST"],
      explicitApiBaseUrl,
      currentContainerNetworks
    )
  ) {
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

const findReachableApiBaseUrlOrNull = (
  candidateUrls: ReadonlyArray<string>,
  expectedRevision: string | undefined
): Effect.Effect<string | null> =>
  findReachableApiBaseUrl(candidateUrls, expectedRevision).pipe(
    Effect.match({
      onFailure: () => null,
      onSuccess: (apiBaseUrl) => apiBaseUrl
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
  readonly currentImageRevision: string | null
  readonly buildController: boolean
  readonly forceRecreateController: boolean
  readonly currentContainerNetworks: DockerNetworkIps
  readonly initialControllerNetworks: DockerNetworkIps
}

const loadControllerBootstrapContext = (): ControllerEffect<ControllerBootstrapContext> =>
  Effect.gen(function*(_) {
    yield* _(prepareControllerRuntimeEnv())
    yield* _(prepareControllerResourceLimitEnv())
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    const localControllerRevision = yield* _(ControllerDocker.prepareLocalControllerRevision())
    const isCurrentControllerExists = yield* _(ControllerDocker.controllerExists())
    const currentControllerRevision = yield* _(ControllerDocker.inspectControllerRevision())
    const currentImageRevision = yield* _(inspectControllerImageRevision())
    const currentContainerNetworks = yield* _(ControllerDocker.resolveCurrentContainerNetworks())
    const initialControllerNetworks = yield* _(
      ControllerDocker.inspectContainerNetworks(ControllerDocker.controllerContainerName)
    )
    const isForceRecreateForResourceLimits = shouldForceRecreateForControllerResourceLimits()
    const isForceRecreateController = isForceRecreateForResourceLimits ||
      shouldForceRecreateController(isCurrentControllerExists, localControllerRevision, currentControllerRevision)

    return {
      explicitApiBaseUrl,
      localControllerRevision,
      currentControllerRevision,
      currentImageRevision,
      buildController: shouldBuildControllerImage({
        currentControllerRevision,
        currentImageRevision,
        forceRecreateController: isForceRecreateController,
        localControllerRevision
      }),
      forceRecreateController: isForceRecreateController,
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
    defaultLocalApiBaseUrl: resolveDefaultLocalApiBaseUrl(),
    cachedApiBaseUrl: selectedApiBaseUrl,
    defaultApiBaseUrl: resolveConfiguredApiBaseUrl(),
    currentContainerNetworks,
    controllerNetworks,
    port: resolveApiPort()
  })

const reuseReachableControllerIfPossible = (
  context: ControllerBootstrapContext
): Effect.Effect<boolean, ControllerBootstrapError> =>
  findReachableApiBaseUrlOrNull(
    buildBootstrapCandidateUrls(
      context.explicitApiBaseUrl,
      context.currentContainerNetworks,
      context.initialControllerNetworks
    ),
    context.explicitApiBaseUrl === undefined ? context.localControllerRevision : undefined
  ).pipe(
    Effect.map((reachableApiBaseUrl) => {
      if (reachableApiBaseUrl === null || context.forceRecreateController) {
        return false
      }
      rememberSelectedApiBaseUrl(reachableApiBaseUrl)
      return true
    })
  )

const logControllerStart = (
  context: ControllerBootstrapContext
): Effect.Effect<void> =>
  Effect.log(
    [
      context.buildController ? "Rebuilding docker-git controller" : "Recreating docker-git controller",
      `local revision ${context.localControllerRevision}`,
      `container revision ${context.currentControllerRevision ?? "unknown"}`,
      `image revision ${context.currentImageRevision ?? "unknown"}`
    ].join(": ")
  )

const startAndRememberController = (
  context: ControllerBootstrapContext
): ControllerEffect<void> =>
  Effect.gen(function*(_) {
    if (context.forceRecreateController || context.buildController) {
      yield* _(logControllerStart(context))
    }

    yield* _(ControllerDocker.runCompose(resolveControllerComposeUpArgs(context)))
    yield* _(ControllerDocker.ensureControllerReachabilityNetworks(context.currentContainerNetworks))

    const controllerNetworks = yield* _(
      ControllerDocker.inspectContainerNetworks(ControllerDocker.controllerContainerName)
    )
    const candidateUrls = buildBootstrapCandidateUrls(
      context.explicitApiBaseUrl,
      context.currentContainerNetworks,
      controllerNetworks
    )
    const reachableApiBaseUrl = yield* _(
      waitForReachableApiBaseUrl(
        candidateUrls,
        context.currentContainerNetworks,
        controllerNetworks,
        context.explicitApiBaseUrl === undefined ? context.localControllerRevision : undefined
      )
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
export const ensureControllerReady = (): ControllerEffect<void> =>
  Effect.gen(function*(_) {
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    const defaultLocalApiBaseUrl = resolveDefaultLocalApiBaseUrl()
    if (explicitApiBaseUrl !== undefined) {
      const reachableBeforeDocker = yield* _(
        findReachableDirectHealthProbe({
          cachedApiBaseUrl: selectedApiBaseUrl,
          defaultLocalApiBaseUrl,
          explicitApiBaseUrl
        })
      )
      if (reachableBeforeDocker !== null) {
        rememberSelectedApiBaseUrl(reachableBeforeDocker.apiBaseUrl)
        return
      }
      yield* _(failIfExplicitApiUrlIsUnreachable(explicitApiBaseUrl))
    }

    const localControllerRevision = yield* _(ControllerDocker.prepareLocalControllerRevision())
    const isForceRecreateForResourceLimits = shouldForceRecreateForControllerResourceLimits()
    const reachableBeforeDocker = yield* _(
      findReachableDirectHealthProbe({
        cachedApiBaseUrl: selectedApiBaseUrl,
        defaultLocalApiBaseUrl,
        explicitApiBaseUrl,
        expectedRevision: localControllerRevision
      })
    )
    if (
      reachableBeforeDocker !== null &&
      reachableBeforeDocker.revision === localControllerRevision &&
      !isForceRecreateForResourceLimits
    ) {
      rememberSelectedApiBaseUrl(reachableBeforeDocker.apiBaseUrl)
      return
    }

    const bootstrapContext = yield* _(loadControllerBootstrapContext())
    yield* _(failIfRemoteDockerWithoutApiUrl(bootstrapContext.currentContainerNetworks))
    const isReusedExistingController = yield* _(reuseReachableControllerIfPossible(bootstrapContext))
    if (isReusedExistingController) {
      return
    }
    yield* _(startAndRememberController(bootstrapContext))
  })

export const restartController = (): ControllerEffect<void> =>
  Effect.gen(function*(_) {
    const explicitApiBaseUrl = resolveExplicitApiBaseUrl()
    if (explicitApiBaseUrl !== undefined) {
      yield* _(ensureControllerReady())
      return
    }

    const bootstrapContext = yield* _(loadControllerBootstrapContext())
    yield* _(failIfRemoteDockerWithoutApiUrl(bootstrapContext.currentContainerNetworks))
    const isForceRecreateController = true
    const isBuildController = shouldBuildControllerImage({
      currentControllerRevision: bootstrapContext.currentControllerRevision,
      currentImageRevision: bootstrapContext.currentImageRevision,
      forceRecreateController: isForceRecreateController,
      localControllerRevision: bootstrapContext.localControllerRevision
    })
    yield* _(
      startAndRememberController({
        ...bootstrapContext,
        buildController: isBuildController,
        forceRecreateController: isForceRecreateController
      })
    )
  })
